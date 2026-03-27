-- SignalPot Analyst Suite: Configurable dimension types
-- Defines the axes of analysis (hospital_system, geography, payor, etc.) with optional hierarchy.

CREATE TABLE analyst_dimensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,               -- e.g. "hospital_system", "hospital", "geography", "payor"
  slug TEXT NOT NULL,
  description TEXT,
  parent_dimension_id UUID REFERENCES analyst_dimensions(id) ON DELETE SET NULL,  -- optional hierarchy
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(owner_id, slug)
);

ALTER TABLE analyst_dimensions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own dimensions" ON analyst_dimensions
  FOR ALL USING (auth.uid() = owner_id);
