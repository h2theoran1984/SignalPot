-- Agent health events — drift detection alerts and status changes
CREATE TABLE IF NOT EXISTS agent_health_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('drift_detected', 'recovery', 'degradation', 'model_change')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  metrics_snapshot JSONB NOT NULL DEFAULT '{}',
  message TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_health_events_agent ON agent_health_events(agent_id, detected_at DESC);
CREATE INDEX idx_health_events_unresolved ON agent_health_events(agent_id)
  WHERE resolved_at IS NULL;

-- Agent coaching tips — per-match improvement suggestions
CREATE TABLE IF NOT EXISTS agent_coaching_tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  match_id UUID REFERENCES arena_matches(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('accuracy', 'speed', 'cost', 'schema', 'coherence', 'general')),
  tip TEXT NOT NULL,
  metric_name TEXT,
  current_value NUMERIC,
  baseline_value NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_coaching_tips_agent ON agent_coaching_tips(agent_id, created_at DESC);

-- Agent health status cache (updated by drift check job)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS health_status TEXT DEFAULT 'unknown'
  CHECK (health_status IN ('healthy', 'warning', 'degrading', 'unknown'));
ALTER TABLE agents ADD COLUMN IF NOT EXISTS health_score NUMERIC DEFAULT NULL;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS health_checked_at TIMESTAMPTZ DEFAULT NULL;
