-- AutoTune: versioned prompts + optimization run history
-- Enables hot-swappable system prompts and automated prompt iteration loops.

-- ============================================================
-- prompt_versions — every system prompt variant ever tried
-- ============================================================

CREATE TABLE prompt_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability      TEXT NOT NULL,
  version         INTEGER NOT NULL,
  system_prompt   TEXT NOT NULL,
  model           TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  max_tokens      INTEGER NOT NULL DEFAULT 512,
  temperature     NUMERIC NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT false,
  elo_at_creation INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active prompt per agent+capability
CREATE UNIQUE INDEX idx_prompt_versions_unique_active
  ON prompt_versions (agent_id, capability)
  WHERE is_active = true;

-- Fast lookup by agent+capability
CREATE INDEX idx_prompt_versions_agent_cap
  ON prompt_versions (agent_id, capability, version DESC);

-- Unique version numbers per agent+capability
ALTER TABLE prompt_versions
  ADD CONSTRAINT uq_prompt_versions_agent_cap_ver
  UNIQUE (agent_id, capability, version);

-- ============================================================
-- autotune_runs — each optimization attempt
-- ============================================================

CREATE TABLE autotune_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id             UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability           TEXT NOT NULL,
  iteration            INTEGER NOT NULL DEFAULT 1,

  -- Baseline
  baseline_version_id  UUID REFERENCES prompt_versions(id),
  baseline_elo         INTEGER NOT NULL,
  baseline_record      JSONB,

  -- Candidate
  candidate_version_id UUID REFERENCES prompt_versions(id),
  candidate_elo        INTEGER,
  candidate_record     JSONB,

  -- Decision
  elo_delta            INTEGER,
  kept                 BOOLEAN,
  stopped_reason       TEXT,

  -- Diagnostics
  weakness_analysis    TEXT,
  prompt_diff          TEXT,
  judgment_summaries   JSONB,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ
);

CREATE INDEX idx_autotune_runs_agent
  ON autotune_runs (agent_id, capability, created_at DESC);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE autotune_runs ENABLE ROW LEVEL SECURITY;

-- prompt_versions: public read (agents need to fetch active prompts via anon key)
CREATE POLICY "prompt_versions_select_all"
  ON prompt_versions FOR SELECT
  USING (true);

-- prompt_versions: only service_role can write (via admin client)
CREATE POLICY "prompt_versions_insert_service"
  ON prompt_versions FOR INSERT
  WITH CHECK (current_setting('role') = 'service_role');

CREATE POLICY "prompt_versions_update_service"
  ON prompt_versions FOR UPDATE
  USING (current_setting('role') = 'service_role');

-- autotune_runs: agent owners can read their own runs
CREATE POLICY "autotune_runs_select_owner"
  ON autotune_runs FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM agents WHERE owner_id = auth.uid()
    )
  );

-- autotune_runs: service_role can do everything
CREATE POLICY "autotune_runs_insert_service"
  ON autotune_runs FOR INSERT
  WITH CHECK (current_setting('role') = 'service_role');

CREATE POLICY "autotune_runs_update_service"
  ON autotune_runs FOR UPDATE
  USING (current_setting('role') = 'service_role');

-- ============================================================
-- Grants
-- ============================================================

GRANT SELECT ON prompt_versions TO anon, authenticated;
GRANT ALL ON prompt_versions TO service_role;

GRANT SELECT ON autotune_runs TO authenticated;
GRANT ALL ON autotune_runs TO service_role;
