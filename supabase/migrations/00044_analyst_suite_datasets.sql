-- SignalPot Analyst Suite: Imported data batches
-- Tracks each upload/import run with its status and validation summary.

CREATE TABLE analyst_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES analyst_sources(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                -- e.g. "Q1 2026 Claims Data"
  period TEXT,                       -- e.g. "2026-Q1", "2026-03"
  row_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',     -- pending, normalizing, validated, ready, error
  validation_summary JSONB DEFAULT '{}'::jsonb,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

ALTER TABLE analyst_datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own datasets" ON analyst_datasets
  FOR ALL USING (auth.uid() = owner_id);
