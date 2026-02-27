-- Sprint 3.5: Billing — subscription plans, credit wallet, platform revenue

-- ============================================================
-- 1. Subscription plan tier on profiles
-- ============================================================
CREATE TYPE plan_type AS ENUM ('free', 'pro', 'team');

ALTER TABLE profiles
  ADD COLUMN plan                   plan_type NOT NULL DEFAULT 'free',
  ADD COLUMN stripe_customer_id     TEXT UNIQUE,
  ADD COLUMN stripe_subscription_id TEXT UNIQUE,
  -- Credit wallet stored in millicents (1/1000 of a cent) for sub-cent precision.
  -- Example: $1.00 = 100,000 millicents; $0.001 = 100 millicents.
  ADD COLUMN credit_balance_millicents BIGINT NOT NULL DEFAULT 0;

-- ============================================================
-- 2. Platform revenue ledger (append-only, never updated)
-- ============================================================
CREATE TABLE platform_revenue (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID        REFERENCES jobs(id) ON DELETE SET NULL,
  amount_millicents BIGINT      NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_revenue ENABLE ROW LEVEL SECURITY;
-- Only service_role reads/writes this table — no user-facing policy needed.

-- ============================================================
-- 3. Atomic payment settlement RPC
--    Called when a job transitions to 'completed'.
--    Deducts from caller, credits provider owner, logs platform fee.
--    Raises an exception if the caller has insufficient balance.
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
  v_platform_fee    := floor(v_rate_millicents * p_platform_fee_pct / 100.0)::BIGINT;
  v_provider_cut    := v_rate_millicents - v_platform_fee;

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
-- 4. Credit top-up RPC
--    Called by the Stripe webhook after a successful payment.
--    Atomically adds credits to a user's wallet.
-- ============================================================
CREATE OR REPLACE FUNCTION add_credits(
  p_user_id          UUID,
  p_amount_millicents BIGINT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles
  SET credit_balance_millicents = credit_balance_millicents + p_amount_millicents
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
END;
$$;

-- ============================================================
-- 5. Grants
-- ============================================================
GRANT UPDATE (plan, stripe_customer_id, stripe_subscription_id, credit_balance_millicents)
  ON profiles TO service_role;

GRANT ALL ON platform_revenue TO service_role;

GRANT EXECUTE ON FUNCTION settle_job_payment(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION add_credits(UUID, BIGINT) TO service_role;
