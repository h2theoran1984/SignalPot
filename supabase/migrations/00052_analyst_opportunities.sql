-- SignalPot Analyst Suite: Growth opportunities (Radar agent)
-- Stores detected whitespace, cross-sell, and competitive displacement signals.

CREATE TABLE analyst_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES analyst_datasets(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES analyst_entities(id) ON DELETE SET NULL,  -- the account entity
  account_name TEXT,
  opportunity_type TEXT NOT NULL,             -- whitespace, cross_sell, upsell, win_back, competitive_displacement
  dimension_id UUID REFERENCES analyst_dimensions(id) ON DELETE SET NULL,
  product_or_category TEXT,                   -- what they should be buying
  estimated_value NUMERIC,                    -- projected revenue opportunity
  confidence NUMERIC,                         -- 0-1 confidence score
  evidence JSONB DEFAULT '{}'::jsonb,         -- supporting data points
  -- evidence shape: {
  --   peer_adoption_rate: 0.75,
  --   region_index: 2.1,
  --   competitor_present: true,
  --   historical_purchases: [...],
  --   similar_accounts: [{ name, adopted: true }]
  -- }
  status TEXT DEFAULT 'open',                 -- open, pursuing, won, dismissed
  priority TEXT DEFAULT 'medium',             -- high, medium, low
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_opportunities_owner ON analyst_opportunities(owner_id);
CREATE INDEX idx_opportunities_dataset ON analyst_opportunities(dataset_id);
CREATE INDEX idx_opportunities_type ON analyst_opportunities(opportunity_type);
CREATE INDEX idx_opportunities_status ON analyst_opportunities(status);

ALTER TABLE analyst_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own opportunities" ON analyst_opportunities
  FOR ALL USING (auth.uid() = owner_id);
