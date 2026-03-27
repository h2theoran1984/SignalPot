-- SignalPot Analyst Suite: Configurable validation rules
-- Defines checks that run during data normalization (required fields, range checks, trend deviations, etc.).

CREATE TABLE analyst_validation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  rule_type TEXT NOT NULL,           -- required_field, range_check, cross_source, trend_deviation, custom
  dimension_id UUID REFERENCES analyst_dimensions(id) ON DELETE SET NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,  -- rule-specific parameters
  severity TEXT DEFAULT 'warning',   -- error, warning, info
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(owner_id, name)
);

ALTER TABLE analyst_validation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own rules" ON analyst_validation_rules
  FOR ALL USING (auth.uid() = owner_id);
