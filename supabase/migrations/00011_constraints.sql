-- Sprint 12: Caller hiring constraints
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS caller_constraints JSONB;

COMMENT ON COLUMN jobs.caller_constraints IS
  'Optional caller constraints: { min_trust, required_tags, blocked_agents, max_cost }';
