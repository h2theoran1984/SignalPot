-- 00067_trust_control_tower.sql
-- Trust Control Tower: reliability scoring + traffic safety controls.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS reliability_score NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reliability_band TEXT DEFAULT 'unknown'
    CHECK (reliability_band IN ('elite', 'strong', 'watch', 'critical', 'unknown')),
  ADD COLUMN IF NOT EXISTS reliability_checked_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS traffic_mode TEXT DEFAULT 'normal'
    CHECK (traffic_mode IN ('normal', 'canary', 'frozen')),
  ADD COLUMN IF NOT EXISTS canary_percent INTEGER DEFAULT 100
    CHECK (canary_percent >= 0 AND canary_percent <= 100),
  ADD COLUMN IF NOT EXISTS freeze_until TIMESTAMPTZ DEFAULT NULL;

CREATE TABLE IF NOT EXISTS agent_reliability_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'telemetry_rollup',
  sample_size INTEGER NOT NULL,
  success_rate NUMERIC NOT NULL,
  error_rate NUMERIC NOT NULL,
  avg_latency_ms INTEGER NOT NULL,
  trust_score NUMERIC NOT NULL,
  health_component NUMERIC NOT NULL,
  reliability_score NUMERIC NOT NULL,
  reliability_band TEXT NOT NULL CHECK (reliability_band IN ('elite', 'strong', 'watch', 'critical')),
  drivers JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reliability_snapshots_agent
  ON agent_reliability_snapshots(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reliability_snapshots_score
  ON agent_reliability_snapshots(reliability_score, created_at DESC);

ALTER TABLE agent_reliability_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reliability_snapshots_public_select"
  ON agent_reliability_snapshots
  FOR SELECT
  USING (true);

CREATE POLICY "reliability_snapshots_service_all"
  ON agent_reliability_snapshots
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON agent_reliability_snapshots TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON agent_reliability_snapshots TO service_role;
