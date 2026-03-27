-- SignalPot Analyst Suite: Pipeline orchestration runs
-- Tracks end-to-end pipeline execution from file upload through Brief compilation.

CREATE TABLE analyst_pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES analyst_datasets(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'uploading',  -- uploading, parsing, normalizing, validating, investigating, compiling, completed, failed
  current_step TEXT,                          -- human-readable step description
  steps_completed INTEGER DEFAULT 0,
  steps_total INTEGER DEFAULT 6,             -- parse, map-columns, normalize, validate, investigate, compile
  file_name TEXT,
  file_size INTEGER,
  row_count INTEGER,
  column_map JSONB DEFAULT '{}'::jsonb,      -- detected column → dimension/metric mappings
  results JSONB DEFAULT '{}'::jsonb,         -- aggregated results from each step
  error TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_pipeline_runs_dataset ON analyst_pipeline_runs(dataset_id);
CREATE INDEX idx_pipeline_runs_owner ON analyst_pipeline_runs(owner_id);
CREATE INDEX idx_pipeline_runs_status ON analyst_pipeline_runs(status);

ALTER TABLE analyst_pipeline_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own pipeline runs" ON analyst_pipeline_runs
  FOR ALL USING (auth.uid() = owner_id);
