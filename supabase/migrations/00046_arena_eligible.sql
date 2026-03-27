-- Add arena_eligible flag to agents table
-- Defaults to true for backward compatibility
ALTER TABLE agents ADD COLUMN IF NOT EXISTS arena_eligible BOOLEAN DEFAULT true;

-- Set arena_eligible to false for suite agents and internal platform agents
UPDATE agents SET arena_eligible = false WHERE listing_type = 'suite';
UPDATE agents SET arena_eligible = false WHERE parent_agent_id IS NOT NULL;

CREATE INDEX idx_agents_arena_eligible ON agents(arena_eligible);
