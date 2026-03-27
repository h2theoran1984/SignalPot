-- SignalPot Analyst Suite: Detected anomalies
-- Stores anomalies found by Pathfinder with statistical context and optional LLM explanations.

CREATE TABLE analyst_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES analyst_datasets(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  record_id UUID REFERENCES analyst_records(id) ON DELETE SET NULL,
  metric TEXT NOT NULL,                       -- which metric was anomalous
  value NUMERIC NOT NULL,                     -- the anomalous value
  expected_mean NUMERIC,                      -- population mean at detection time
  expected_stddev NUMERIC,                    -- population std dev
  z_score NUMERIC,                            -- how many std devs away
  direction TEXT,                             -- 'high' or 'low'
  severity TEXT DEFAULT 'warning',            -- error, warning, info
  context JSONB DEFAULT '{}'::jsonb,          -- entity mappings, period, etc. for display
  explanation TEXT,                           -- LLM-generated root cause analysis
  explanation_model TEXT,                     -- which model generated the explanation
  status TEXT DEFAULT 'open',                 -- open, acknowledged, resolved, false_positive
  created_at TIMESTAMPTZ DEFAULT now(),
  explained_at TIMESTAMPTZ
);

CREATE INDEX idx_anomalies_dataset ON analyst_anomalies(dataset_id);
CREATE INDEX idx_anomalies_owner ON analyst_anomalies(owner_id);
CREATE INDEX idx_anomalies_status ON analyst_anomalies(status);

ALTER TABLE analyst_anomalies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own anomalies" ON analyst_anomalies
  FOR ALL USING (auth.uid() = owner_id);
