-- SignalPot Analyst Suite: Canonical entity registry (the taxonomy)
-- The "golden" names for each entity within a dimension, with optional parent hierarchy.

CREATE TABLE analyst_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  dimension_id UUID NOT NULL REFERENCES analyst_dimensions(id) ON DELETE CASCADE,
  canonical_name TEXT NOT NULL,      -- the "golden" name
  parent_entity_id UUID REFERENCES analyst_entities(id) ON DELETE SET NULL,  -- hierarchy within dimension
  metadata JSONB DEFAULT '{}'::jsonb,  -- flexible extra fields (e.g. state, region, system_type)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(owner_id, dimension_id, canonical_name)
);

CREATE INDEX idx_analyst_entities_dimension ON analyst_entities(dimension_id);
CREATE INDEX idx_analyst_entities_parent ON analyst_entities(parent_entity_id);

ALTER TABLE analyst_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own entities" ON analyst_entities
  FOR ALL USING (auth.uid() = owner_id);
