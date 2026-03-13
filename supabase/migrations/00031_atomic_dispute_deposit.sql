-- Atomic dispute deposit deduction to prevent race conditions.
-- Checks balance and deducts in a single UPDATE (like settle_user_payment).
CREATE OR REPLACE FUNCTION public.deduct_dispute_deposit(
  p_profile_id UUID,
  p_amount_millicents BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_amount_millicents <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: must be positive';
  END IF;

  UPDATE profiles
  SET credit_balance_millicents = credit_balance_millicents - p_amount_millicents
  WHERE id = p_profile_id
    AND credit_balance_millicents >= p_amount_millicents;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;
END;
$$;

-- Restrict to service role only
REVOKE ALL ON FUNCTION public.deduct_dispute_deposit(UUID, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deduct_dispute_deposit(UUID, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.deduct_dispute_deposit(UUID, BIGINT) FROM authenticated;
