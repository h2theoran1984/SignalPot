-- Compound indexes for trust_edges score ordering (hot path on agent detail pages)
CREATE INDEX IF NOT EXISTS idx_trust_edges_target_score
  ON trust_edges(target_agent_id, trust_score DESC)
  WHERE trust_score > 0;

CREATE INDEX IF NOT EXISTS idx_trust_edges_source_score
  ON trust_edges(source_agent_id, trust_score DESC)
  WHERE trust_score > 0;

-- Compound index for active public agent listings (marketplace browse)
CREATE INDEX IF NOT EXISTS idx_agents_active_public
  ON agents(status, visibility, created_at DESC)
  WHERE status = 'active' AND visibility = 'public';
