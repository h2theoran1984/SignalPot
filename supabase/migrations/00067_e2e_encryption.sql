-- E2E encryption keypairs for agents
CREATE TABLE IF NOT EXISTS agent_e2e_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kid TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  public_key_jwk JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'rotating', 'retired', 'revoked')),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);

CREATE INDEX idx_e2e_keys_agent_status ON agent_e2e_keys(agent_id, status);
CREATE INDEX idx_e2e_keys_kid ON agent_e2e_keys(kid);

-- E2E flag on agents for quick lookup
ALTER TABLE agents ADD COLUMN IF NOT EXISTS e2e_enabled BOOLEAN NOT NULL DEFAULT false;

-- Track encrypted jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS e2e_encrypted BOOLEAN NOT NULL DEFAULT false;
