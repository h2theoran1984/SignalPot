-- Suite agent architecture: parent-child agent grouping
-- listing_type is separate from agent_type (autonomous/reactive/hybrid)

ALTER TABLE agents ADD COLUMN listing_type TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE agents
  ADD CONSTRAINT agents_listing_type_check
  CHECK (listing_type IN ('standard', 'suite'));

ALTER TABLE agents ADD COLUMN parent_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;

-- Suite agents cannot themselves be children
ALTER TABLE agents
  ADD CONSTRAINT suite_cannot_have_parent
  CHECK (listing_type != 'suite' OR parent_agent_id IS NULL);

CREATE INDEX idx_agents_parent_agent_id ON agents(parent_agent_id)
  WHERE parent_agent_id IS NOT NULL;

CREATE INDEX idx_agents_listing_type ON agents(listing_type);
