-- 00066_auto_rollback_guardrail.sql
-- Auto-Rollback Guardrail: policy, snapshots, and incident tracking.

CREATE TABLE IF NOT EXISTS agent_rollback_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  mode TEXT NOT NULL DEFAULT 'dry_run' CHECK (mode IN ('dry_run', 'active')),
  min_sample_size INTEGER NOT NULL DEFAULT 20 CHECK (min_sample_size >= 1),
  max_error_rate NUMERIC NOT NULL DEFAULT 0.08 CHECK (max_error_rate >= 0 AND max_error_rate <= 1),
  max_latency_ms INTEGER NOT NULL DEFAULT 3000 CHECK (max_latency_ms >= 1),
  min_success_rate NUMERIC NOT NULL DEFAULT 0.90 CHECK (min_success_rate >= 0 AND min_success_rate <= 1),
  min_trust_score NUMERIC NOT NULL DEFAULT 0.55 CHECK (min_trust_score >= 0 AND min_trust_score <= 1),
  cooldown_minutes INTEGER NOT NULL DEFAULT 30 CHECK (cooldown_minutes >= 1),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_config_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  model_id TEXT,
  system_prompt TEXT,
  architect_version INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  is_known_good BOOLEAN NOT NULL DEFAULT false,
  metrics_snapshot JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_rollback_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'ignored', 'simulated')),
  trigger_mode TEXT NOT NULL DEFAULT 'auto' CHECK (trigger_mode IN ('auto', 'manual', 'simulate')),
  rollback_mode TEXT NOT NULL DEFAULT 'dry_run' CHECK (rollback_mode IN ('dry_run', 'active')),
  rollback_executed BOOLEAN NOT NULL DEFAULT false,
  source TEXT,
  reason TEXT,
  violations JSONB NOT NULL DEFAULT '[]',
  metrics_snapshot JSONB NOT NULL DEFAULT '{}',
  policy_snapshot JSONB NOT NULL DEFAULT '{}',
  from_snapshot_id UUID REFERENCES agent_config_snapshots(id) ON DELETE SET NULL,
  target_snapshot_id UUID REFERENCES agent_config_snapshots(id) ON DELETE SET NULL,
  acked_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  acked_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  cooldown_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rollback_policy_agent
  ON agent_rollback_policies(agent_id);

CREATE INDEX IF NOT EXISTS idx_config_snapshots_agent
  ON agent_config_snapshots(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_config_snapshots_known_good
  ON agent_config_snapshots(agent_id, created_at DESC)
  WHERE is_known_good = true;

CREATE INDEX IF NOT EXISTS idx_rollback_incidents_agent
  ON agent_rollback_incidents(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rollback_incidents_open
  ON agent_rollback_incidents(agent_id)
  WHERE status IN ('open', 'acknowledged');

ALTER TABLE agent_rollback_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_config_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_rollback_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rollback_policies_service_all"
  ON agent_rollback_policies
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "config_snapshots_service_all"
  ON agent_config_snapshots
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "rollback_incidents_service_all"
  ON agent_rollback_incidents
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE ON agent_rollback_policies TO service_role;
GRANT SELECT, INSERT, UPDATE ON agent_config_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE ON agent_rollback_incidents TO service_role;
