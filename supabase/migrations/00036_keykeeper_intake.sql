-- KeyKeeper intake: one-time magic link tokens for secret submission

CREATE TABLE keykeeper_intake_tokens (
  token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  secret_name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'stripe', 'github', 'other')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_keykeeper_intake_owner ON keykeeper_intake_tokens(owner_id);

ALTER TABLE keykeeper_intake_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own intake tokens"
  ON keykeeper_intake_tokens FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "Users can insert their own intake tokens"
  ON keykeeper_intake_tokens FOR INSERT WITH CHECK (owner_id = auth.uid());

-- Service role needs full access for unauthenticated intake route
GRANT ALL ON keykeeper_intake_tokens TO service_role;
