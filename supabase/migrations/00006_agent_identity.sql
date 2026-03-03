-- Sprint 6: Agent identity fields — goal, decision_logic, agent_type
-- These fields distinguish agents (autonomous decision-makers) from tools (passive endpoints)
-- Added as nullable initially — 30-day grace period before enforcement

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS goal           TEXT,          -- What the agent is trying to achieve (max 500 chars enforced in API)
  ADD COLUMN IF NOT EXISTS decision_logic TEXT,          -- How the agent decides what to do (max 2000 chars enforced in API)
  ADD COLUMN IF NOT EXISTS agent_type     TEXT NOT NULL DEFAULT 'autonomous';  -- autonomous | reactive | hybrid

-- Constraint on agent_type enum values
ALTER TABLE agents
  ADD CONSTRAINT agents_agent_type_check
  CHECK (agent_type IN ('autonomous', 'reactive', 'hybrid'));

-- Indexes for future filtering by agent_type
CREATE INDEX IF NOT EXISTS idx_agents_agent_type ON agents(agent_type);
