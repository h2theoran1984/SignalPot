-- Arena Processors: pluggable pre-processors that AutoTune can discover and activate.
-- Each processor enriches prompts before agents see them and adds verification
-- context for the judge. Example: date-resolver resolves relative dates to ISO.

-- ============================================================
-- agent_processors — tracks active processors per agent+capability
-- ============================================================

CREATE TABLE agent_processors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability        TEXT NOT NULL,
  processor_id      TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  activated_by      TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'autotune'
  autotune_run_id   UUID REFERENCES autotune_runs(id),
  elo_at_activation INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active instance of each processor per agent+capability
CREATE UNIQUE INDEX idx_agent_processors_unique_active
  ON agent_processors (agent_id, capability, processor_id)
  WHERE is_active = true;

-- Fast lookup by agent+capability
CREATE INDEX idx_agent_processors_lookup
  ON agent_processors (agent_id, capability)
  WHERE is_active = true;

-- Add processor tracking to autotune_runs
ALTER TABLE autotune_runs ADD COLUMN processors_activated JSONB;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE agent_processors ENABLE ROW LEVEL SECURITY;

-- Public read (agents/UI need to check active processors)
CREATE POLICY "agent_processors_select_all"
  ON agent_processors FOR SELECT
  USING (true);

-- Only service_role can write (via admin client)
CREATE POLICY "agent_processors_insert_service"
  ON agent_processors FOR INSERT
  WITH CHECK (current_setting('role') = 'service_role');

CREATE POLICY "agent_processors_update_service"
  ON agent_processors FOR UPDATE
  USING (current_setting('role') = 'service_role');

-- ============================================================
-- Grants
-- ============================================================

GRANT SELECT ON agent_processors TO anon, authenticated;
GRANT ALL ON agent_processors TO service_role;
