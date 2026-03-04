-- Sprint 7a: Trust Hardening v1
-- 1. Add stale + decay columns to trust_edges
-- 2. Enforce $0.001 minimum fee in settle_job_payment
-- 3. Stake-weighted trust score trigger

-- ============================================================
-- 1. trust_edges: stale flag + decay timestamp
-- ============================================================
ALTER TABLE trust_edges
  ADD COLUMN IF NOT EXISTS stale BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS decay_applied_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Also add updated_at so the decay function can check last activity
ALTER TABLE trust_edges
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_trust_edges_stale ON trust_edges(stale) WHERE stale = false;
CREATE INDEX IF NOT EXISTS idx_trust_edges_decay ON trust_edges(decay_applied_at);

-- Trigger to keep trust_edges.updated_at fresh
CREATE OR REPLACE FUNCTION update_trust_edges_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trust_edges_updated_at ON trust_edges;
CREATE TRIGGER trust_edges_updated_at
  BEFORE UPDATE ON trust_edges
  FOR EACH ROW EXECUTE FUNCTION update_trust_edges_updated_at();

-- ============================================================
-- 2. settle_job_payment — $0.001 minimum fee
--    Reproduced in full from 00005_plans.sql with additions:
--    a) Raise exception if rate < 100 millicents ($0.001)
--    b) Enforce minimum platform fee of 100 millicents ($0.001)
-- ============================================================
CREATE OR REPLACE FUNCTION settle_job_payment(
  p_job_id          UUID,
  p_platform_fee_pct INTEGER DEFAULT 10
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate_amount           NUMERIC;
  v_requester_profile_id  UUID;
  v_provider_owner_id     UUID;
  v_rate_millicents       BIGINT;
  v_platform_fee          BIGINT;
  v_provider_cut          BIGINT;
  v_caller_balance        BIGINT;
BEGIN
  -- Fetch job, agent rate_amount, and agent owner in one shot
  SELECT
    j.requester_profile_id,
    a.rate_amount,
    a.owner_id
  INTO
    v_requester_profile_id,
    v_rate_amount,
    v_provider_owner_id
  FROM jobs j
  JOIN agents a ON a.id = j.provider_agent_id
  WHERE j.id = p_job_id;

  -- Nothing to settle for free agents or anonymous callers
  IF v_rate_amount IS NULL OR v_rate_amount = 0
     OR v_requester_profile_id IS NULL THEN
    RETURN;
  END IF;

  -- Convert dollars → millicents
  v_rate_millicents := floor(v_rate_amount * 100000)::BIGINT;

  -- Enforce $0.001 minimum rate
  IF v_rate_millicents < 100 THEN
    RAISE EXCEPTION 'rate_below_minimum';
  END IF;

  v_platform_fee := floor(v_rate_millicents * p_platform_fee_pct / 100.0)::BIGINT;

  -- Enforce $0.001 minimum platform fee
  v_platform_fee := GREATEST(v_platform_fee, 100);

  v_provider_cut := v_rate_millicents - v_platform_fee;

  -- Check caller balance
  SELECT credit_balance_millicents
  INTO v_caller_balance
  FROM profiles
  WHERE id = v_requester_profile_id
  FOR UPDATE;  -- row-level lock to prevent race conditions

  IF v_caller_balance < v_rate_millicents THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  -- Deduct from caller
  UPDATE profiles
  SET credit_balance_millicents = credit_balance_millicents - v_rate_millicents
  WHERE id = v_requester_profile_id;

  -- Credit provider owner (may be same person — Postgres handles it fine)
  UPDATE profiles
  SET credit_balance_millicents = credit_balance_millicents + v_provider_cut
  WHERE id = v_provider_owner_id;

  -- Log platform revenue
  INSERT INTO platform_revenue (job_id, amount_millicents)
  VALUES (p_job_id, v_platform_fee);
END;
$$;

-- ============================================================
-- 3. Stake-weighted trust score trigger
--    Reproduced in full from 00002_security_hardening.sql with:
--    - weight_factor = 1.0 + ln(1.0 + (total_spent_as_millicents / 100000.0))
--      where total_spent_as_millicents = total_spent * 100000 (total_spent is in dollars)
--    - trust_score capped at 1.0
-- ============================================================
CREATE OR REPLACE FUNCTION update_trust_edge_on_job()
RETURNS TRIGGER AS $$
DECLARE
  v_base_score    NUMERIC;
  v_weight_factor NUMERIC;
  v_new_total_spent NUMERIC;
BEGIN
  IF NEW.status = 'completed' AND NEW.requester_agent_id IS NOT NULL THEN
    INSERT INTO trust_edges (
      source_agent_id, target_agent_id,
      total_jobs, successful_jobs, production_jobs,
      total_spent, avg_latency_ms, last_job_at,
      trust_score
    )
    VALUES (
      NEW.requester_agent_id,
      NEW.provider_agent_id,
      1,
      1,
      CASE WHEN NEW.job_type = 'production' THEN 1 ELSE 0 END,
      COALESCE(NEW.cost, 0),
      COALESCE(NEW.duration_ms, 0),
      now(),
      -- First job: base score with stake weight
      LEAST(1.0,
        (CASE WHEN NEW.job_type = 'production' THEN 1.0 ELSE 0.5 END)
        * (1.0 + ln(1.0 + (COALESCE(NEW.cost, 0) * 100000.0 / 100000.0)))
      )
    )
    ON CONFLICT (source_agent_id, target_agent_id) DO UPDATE SET
      total_jobs      = trust_edges.total_jobs + 1,
      successful_jobs = trust_edges.successful_jobs + 1,
      production_jobs = trust_edges.production_jobs + CASE WHEN NEW.job_type = 'production' THEN 1 ELSE 0 END,
      total_spent     = trust_edges.total_spent + COALESCE(NEW.cost, 0),
      avg_latency_ms  = (trust_edges.avg_latency_ms * trust_edges.total_jobs + COALESCE(NEW.duration_ms, 0)) / (trust_edges.total_jobs + 1),
      last_job_at     = now(),
      trust_score     = LEAST(1.0,
        -- Base score: success rate * production bonus (same formula as before)
        (
          (trust_edges.successful_jobs + 1)::NUMERIC / (trust_edges.total_jobs + 1)
          * (1 + 0.5 * (
              (trust_edges.production_jobs + CASE WHEN NEW.job_type = 'production' THEN 1 ELSE 0 END)::NUMERIC
              / GREATEST(trust_edges.total_jobs + 1, 1)
            ))
        )
        -- Stake weight: logarithmic scaling on total spend (dollars → treat as millicents proxy)
        * (1.0 + ln(1.0 + ((trust_edges.total_spent + COALESCE(NEW.cost, 0)) * 100000.0 / 100000.0)))
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grants (idempotent — OR REPLACE handles functions)
GRANT EXECUTE ON FUNCTION settle_job_payment(UUID, INTEGER) TO service_role;
