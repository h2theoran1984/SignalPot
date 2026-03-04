-- Sprint 8: Billing Extension — Reserve + Escrow Foundation

-- ============================================================
-- 1. escrow_holds table
-- ============================================================
CREATE TABLE IF NOT EXISTS escrow_holds (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  payer_profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount_millicents   BIGINT NOT NULL CHECK (amount_millicents > 0),
  hold_type           TEXT NOT NULL CHECK (hold_type IN ('deposit', 'reserve')),
  status              TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released', 'forfeited')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_escrow_holds_job    ON escrow_holds(job_id);
CREATE INDEX IF NOT EXISTS idx_escrow_holds_payer  ON escrow_holds(payer_profile_id);
CREATE INDEX IF NOT EXISTS idx_escrow_holds_status ON escrow_holds(status) WHERE status = 'held';

-- ============================================================
-- 2. dispute_reserve table
-- ============================================================
CREATE TABLE IF NOT EXISTS dispute_reserve (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID REFERENCES jobs(id) ON DELETE SET NULL,
  source              TEXT NOT NULL CHECK (source IN ('reserve_contribution', 'dispute_forfeit')),
  amount_millicents   BIGINT NOT NULL CHECK (amount_millicents > 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. settle_job_payment — add 2% dispute reserve holdback
--    Based on Sprint 7 version with additions:
--    a) 2% reserve calculated after platform fee
--    b) Provider gets rate - 10% platform fee - 2% reserve (= 88%)
--    c) Reserve logged to dispute_reserve table
--    d) Reserve hold recorded in escrow_holds table
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
  v_reserve               BIGINT;
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

  -- 2% dispute reserve holdback (calculated after platform fee)
  v_reserve := floor(v_rate_millicents * 2 / 100)::BIGINT;

  -- Provider gets remainder after platform fee and reserve
  v_provider_cut := v_rate_millicents - v_platform_fee - v_reserve;

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

  -- Log reserve contribution to dispute_reserve
  INSERT INTO dispute_reserve (job_id, source, amount_millicents)
  VALUES (p_job_id, 'reserve_contribution', v_reserve);

  -- Record escrow hold for the reserve amount
  INSERT INTO escrow_holds (job_id, payer_profile_id, amount_millicents, hold_type)
  VALUES (p_job_id, v_requester_profile_id, v_reserve, 'reserve');
END;
$$;

-- ============================================================
-- 4. RLS policies and grants
-- ============================================================
ALTER TABLE escrow_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_reserve ENABLE ROW LEVEL SECURITY;

-- escrow_holds: payer can see their own holds
CREATE POLICY "escrow_holds_select_own" ON escrow_holds
  FOR SELECT USING (payer_profile_id = auth.uid());

-- dispute_reserve: service_role only (platform internal)
-- (no user-facing policy needed)

GRANT SELECT ON escrow_holds TO authenticated;
GRANT ALL ON escrow_holds TO service_role;
GRANT ALL ON dispute_reserve TO service_role;
GRANT EXECUTE ON FUNCTION settle_job_payment(UUID, INTEGER) TO service_role;
