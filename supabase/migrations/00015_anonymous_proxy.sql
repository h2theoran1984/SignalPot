-- 00015: Anonymous proxy infrastructure
-- Adds: anonymous_sessions, idempotency_keys tables
-- Adds: settle_anonymous_payment RPC
-- Adds: anonymous_session_id column to jobs

-- Anonymous sessions: lightweight credit wallets for unauthenticated callers
CREATE TABLE anonymous_sessions (
  session_token  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_balance_millicents BIGINT NOT NULL DEFAULT 0,
  ip_address     INET NOT NULL,
  stripe_session_id TEXT UNIQUE,
  daily_spend_millicents BIGINT NOT NULL DEFAULT 0,
  daily_spend_reset_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('day', now() + interval '1 day'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
);

CREATE INDEX idx_anon_sessions_expires ON anonymous_sessions(expires_at);
CREATE INDEX idx_anon_sessions_stripe ON anonymous_sessions(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- Idempotency keys: prevent duplicate proxy calls
CREATE TABLE idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  job_id          UUID REFERENCES jobs(id) ON DELETE CASCADE,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);

-- Add anonymous_session_id to jobs for tracking anonymous callers
ALTER TABLE jobs ADD COLUMN anonymous_session_id UUID REFERENCES anonymous_sessions(session_token) ON DELETE SET NULL;
CREATE INDEX idx_jobs_anon_session ON jobs(anonymous_session_id) WHERE anonymous_session_id IS NOT NULL;

-- settle_anonymous_payment: atomic balance check + deduction for anonymous sessions
-- Separate from settle_job_payment (which operates on profiles)
CREATE OR REPLACE FUNCTION settle_anonymous_payment(
  p_session_token       UUID,
  p_amount_millicents   BIGINT,
  p_daily_cap_millicents BIGINT DEFAULT 500000  -- $5.00
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
  v_daily   BIGINT;
  v_reset   TIMESTAMPTZ;
BEGIN
  -- Lock the row and fetch current state
  SELECT credit_balance_millicents, daily_spend_millicents, daily_spend_reset_at
  INTO v_balance, v_daily, v_reset
  FROM anonymous_sessions
  WHERE session_token = p_session_token
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND_OR_EXPIRED';
  END IF;

  -- Reset daily counter if past reset time
  IF now() >= v_reset THEN
    v_daily := 0;
    v_reset := date_trunc('day', now() + interval '1 day');
  END IF;

  -- Check daily spend cap
  IF v_daily + p_amount_millicents > p_daily_cap_millicents THEN
    RAISE EXCEPTION 'DAILY_SPEND_CAP_EXCEEDED';
  END IF;

  -- Check sufficient balance
  IF v_balance < p_amount_millicents THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  -- Atomic deduction
  UPDATE anonymous_sessions
  SET credit_balance_millicents = credit_balance_millicents - p_amount_millicents,
      daily_spend_millicents = v_daily + p_amount_millicents,
      daily_spend_reset_at = v_reset
  WHERE session_token = p_session_token
    AND credit_balance_millicents >= p_amount_millicents;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;
END;
$$;

-- RLS: service_role only (all access through admin client in API routes)
ALTER TABLE anonymous_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT ALL ON anonymous_sessions TO service_role;
GRANT ALL ON idempotency_keys TO service_role;
GRANT EXECUTE ON FUNCTION settle_anonymous_payment(UUID, BIGINT, BIGINT) TO service_role;
