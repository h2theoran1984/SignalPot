-- 00058: Agent Telemetry Beacon
-- Lightweight tracking table for external agent usage.
-- Agents POST usage events to /api/track; a cron job rolls them up
-- into trust_edges, agent stats, and economics.

CREATE TABLE agent_telemetry (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Event data
  event       TEXT NOT NULL DEFAULT 'call_completed',
  capability  TEXT,
  duration_ms INTEGER,
  api_cost    NUMERIC DEFAULT 0,
  cost        NUMERIC DEFAULT 0,
  success     BOOLEAN DEFAULT true,
  caller      TEXT,                      -- e.g. "external", "mcp", agent slug
  metadata    JSONB DEFAULT '{}',

  -- Rollup tracking
  rolled_up   BOOLEAN NOT NULL DEFAULT false,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for the rollup job: grab unprocessed rows efficiently
CREATE INDEX idx_telemetry_pending ON agent_telemetry (rolled_up, created_at)
  WHERE rolled_up = false;

-- Index for per-agent queries
CREATE INDEX idx_telemetry_agent ON agent_telemetry (agent_id, created_at DESC);

-- RLS: service role only (beacon endpoint uses admin client)
ALTER TABLE agent_telemetry ENABLE ROW LEVEL SECURITY;

-- Add total_external_calls to agents for quick stats
ALTER TABLE agents ADD COLUMN IF NOT EXISTS total_external_calls INTEGER NOT NULL DEFAULT 0;
