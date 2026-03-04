-- 00014: RPC hardening
-- Fixes: add_credits allows negative amounts (#8), settle_job_payment race condition (#7)

-- add_credits: reject non-positive amounts
CREATE OR REPLACE FUNCTION add_credits(
  p_user_id          UUID,
  p_amount_millicents BIGINT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_amount_millicents <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: must be positive';
  END IF;

  UPDATE profiles
  SET credit_balance_millicents = credit_balance_millicents + p_amount_millicents
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
END;
$$;

-- settle_job_payment: atomic balance check (replaces SELECT...FOR UPDATE + separate UPDATE)
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

  -- 2% dispute reserve holdback
  v_reserve := floor(v_rate_millicents * 2 / 100)::BIGINT;

  -- Provider gets remainder after platform fee and reserve
  v_provider_cut := v_rate_millicents - v_platform_fee - v_reserve;

  -- Atomic balance check + deduction in a single UPDATE (no race condition)
  UPDATE profiles
  SET credit_balance_millicents = credit_balance_millicents - v_rate_millicents
  WHERE id = v_requester_profile_id
    AND credit_balance_millicents >= v_rate_millicents;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  -- Credit provider owner
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
