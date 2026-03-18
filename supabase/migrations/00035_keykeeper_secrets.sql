-- KeyKeeper: encrypted secrets vault for agent owners

CREATE TABLE keykeeper_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'stripe', 'github', 'other')),
  rotation_days INTEGER NOT NULL DEFAULT 90,
  last_rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE INDEX idx_keykeeper_secrets_owner ON keykeeper_secrets(owner_id);

ALTER TABLE keykeeper_secrets ENABLE ROW LEVEL SECURITY;

-- RLS: owners can only access their own rows
CREATE POLICY "Users can view their own secrets"
  ON keykeeper_secrets FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "Users can insert their own secrets"
  ON keykeeper_secrets FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update their own secrets"
  ON keykeeper_secrets FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "Users can delete their own secrets"
  ON keykeeper_secrets FOR DELETE USING (owner_id = auth.uid());

-- Service role needs access for server-side decrypt
GRANT ALL ON keykeeper_secrets TO service_role;
