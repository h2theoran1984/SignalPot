-- SignalPot Analyst Suite: Normalized data rows
-- The actual data after column mapping, entity resolution, and validation.

CREATE TABLE analyst_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES analyst_datasets(id) ON DELETE CASCADE,
  entity_mappings JSONB NOT NULL DEFAULT '{}'::jsonb,  -- dimension_slug -> entity_id mappings
  raw_values JSONB NOT NULL DEFAULT '{}'::jsonb,       -- original source values
  normalized_values JSONB NOT NULL DEFAULT '{}'::jsonb, -- cleaned/normalized values
  period TEXT,                       -- time period for this record
  metric_name TEXT,                  -- e.g. "unit_share", "volume", "growth_rate"
  metric_value NUMERIC,
  flags JSONB DEFAULT '[]'::jsonb,   -- validation flags/warnings
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_analyst_records_dataset ON analyst_records(dataset_id);
CREATE INDEX idx_analyst_records_period ON analyst_records(period);
CREATE INDEX idx_analyst_records_metric ON analyst_records(metric_name);

ALTER TABLE analyst_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own records" ON analyst_records
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM analyst_datasets d WHERE d.id = dataset_id AND d.owner_id = auth.uid()
    )
  );
