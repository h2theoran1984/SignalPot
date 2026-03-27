-- SignalPot Analyst Suite: Alias mapping
-- Maps variant names (as they appear in source data) to canonical entities.

CREATE TABLE analyst_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES analyst_entities(id) ON DELETE CASCADE,
  source_id UUID REFERENCES analyst_sources(id) ON DELETE SET NULL,  -- which vendor uses this name
  alias TEXT NOT NULL,               -- the variant name as it appears in source data
  confidence TEXT DEFAULT 'manual',  -- manual, high, medium, low (how it was matched)
  matched_by TEXT DEFAULT 'user',    -- user, fast_pass, smart_pass
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_id, alias, source_id)
);

CREATE INDEX idx_analyst_aliases_alias ON analyst_aliases(alias);
CREATE INDEX idx_analyst_aliases_source ON analyst_aliases(source_id);

ALTER TABLE analyst_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own aliases" ON analyst_aliases
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM analyst_entities e WHERE e.id = entity_id AND e.owner_id = auth.uid()
    )
  );
