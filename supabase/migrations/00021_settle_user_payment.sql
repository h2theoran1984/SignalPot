-- 00021: Authenticated user payment for proxy & arena routes
-- Adds settle_user_payment RPC for synchronous pre-deduction from profiles.credit_balance_millicents
-- Modeled after settle_anonymous_payment (00015) but targets the profiles table.

CREATE OR REPLACE FUNCTION settle_user_payment(
  p_profile_id        UUID,
  p_amount_millicents BIGINT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  -- Validate amount
  IF p_amount_millicents <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: must be positive';
  END IF;

  -- Atomic balance check + deduction (single UPDATE, no race condition)
  UPDATE profiles
  SET credit_balance_millicents = credit_balance_millicents - p_amount_millicents
  WHERE id = p_profile_id
    AND credit_balance_millicents >= p_amount_millicents;

  IF NOT FOUND THEN
    -- Distinguish between user not found and insufficient balance
    SELECT credit_balance_millicents INTO v_balance
    FROM profiles WHERE id = p_profile_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'USER_NOT_FOUND';
    ELSE
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
    END IF;
  END IF;
END;
$$;

-- Only service_role can call this (admin client in Next.js routes)
GRANT EXECUTE ON FUNCTION settle_user_payment(UUID, BIGINT) TO service_role;
