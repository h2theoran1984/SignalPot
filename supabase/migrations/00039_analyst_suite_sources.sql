-- SignalPot Analyst Suite: Data source registry
-- Tracks external data sources (vendors, state data, etc.) and how their columns/values map to canonical fields.

CREATE TABLE analyst_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,               -- e.g. "Sg2", "StateClaims-OH"
  slug TEXT NOT NULL,               -- URL-safe identifier
  description TEXT,
  format_type TEXT DEFAULT 'csv',   -- csv, xlsx, json, api
  column_map JSONB DEFAULT '{}'::jsonb,  -- maps source columns to canonical fields
  dimension_map JSONB DEFAULT '{}'::jsonb, -- maps source dimension values to canonical
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(owner_id, slug)
);

ALTER TABLE analyst_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own sources" ON analyst_sources
  FOR ALL USING (auth.uid() = owner_id);
