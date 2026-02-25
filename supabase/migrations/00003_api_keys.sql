-- API Keys for machine-to-machine authentication
-- Enables agents and SDKs to authenticate without browser cookies

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{agents:read,agents:write,jobs:read,jobs:write,trust:read}',
  rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own api keys"
  ON api_keys FOR SELECT
  USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert their own api keys"
  ON api_keys FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update their own api keys"
  ON api_keys FOR UPDATE
  USING (auth.uid() = profile_id);

CREATE POLICY "Users can delete their own api keys"
  ON api_keys FOR DELETE
  USING (auth.uid() = profile_id);

CREATE INDEX idx_api_keys_hash ON api_keys (key_hash);
CREATE INDEX idx_api_keys_profile ON api_keys (profile_id);
