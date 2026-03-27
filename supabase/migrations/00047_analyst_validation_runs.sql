-- SignalPot Analyst Suite: Validation run history
-- Tracks each Sentinel validation run and its findings per dataset.

CREATE TABLE analyst_validation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES analyst_datasets(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',  -- running, completed, failed
  rules_applied INTEGER DEFAULT 0,
  total_findings INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  warnings INTEGER DEFAULT 0,
  infos INTEGER DEFAULT 0,
  findings JSONB DEFAULT '[]'::jsonb,      -- array of { rule_id, rule_name, severity, field, message, record_ids }
  summary JSONB DEFAULT '{}'::jsonb,       -- aggregated summary for quick display
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_validation_runs_dataset ON analyst_validation_runs(dataset_id);
CREATE INDEX idx_validation_runs_owner ON analyst_validation_runs(owner_id);

ALTER TABLE analyst_validation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own validation runs" ON analyst_validation_runs
  FOR ALL USING (auth.uid() = owner_id);
