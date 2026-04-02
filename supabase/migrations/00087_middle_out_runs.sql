-- 00087: Middle Out run history
-- Stores complete results from every Middle Out training run,
-- accessible from the agent dashboard.

CREATE TABLE middle_out_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability      TEXT NOT NULL,
  level           INTEGER NOT NULL DEFAULT 1,
  training_goal   TEXT,
  factor_weights  JSONB NOT NULL,           -- {accuracy, speed, cost, reliability}
  start_dot       JSONB NOT NULL,           -- {accuracy, speed, cost, reliability, weissman_score}
  end_dot         JSONB NOT NULL,
  improvement     JSONB NOT NULL,           -- per-axis deltas
  iterations      JSONB NOT NULL,           -- full iteration array
  challenges_used INTEGER NOT NULL DEFAULT 0,
  weissman_start  NUMERIC NOT NULL DEFAULT 0,
  weissman_end    NUMERIC NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_middle_out_runs_agent ON middle_out_runs (agent_id, created_at DESC);
CREATE INDEX idx_middle_out_runs_capability ON middle_out_runs (capability, level);

-- RLS
ALTER TABLE middle_out_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON middle_out_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "users_read_own_runs" ON middle_out_runs
  FOR SELECT TO authenticated
  USING (agent_id IN (SELECT id FROM agents WHERE owner_id = auth.uid()));
