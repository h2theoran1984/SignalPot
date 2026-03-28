-- SignalPot Analyst Suite: Account health scores (Pulse agent)
-- Tracks account-level health signals computed from order/transaction patterns.

CREATE TABLE analyst_account_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  dataset_id UUID NOT NULL REFERENCES analyst_datasets(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES analyst_entities(id) ON DELETE SET NULL,  -- the account entity
  account_name TEXT,                          -- denormalized for display
  health_score NUMERIC NOT NULL DEFAULT 0,    -- 0-100 composite score
  status TEXT DEFAULT 'healthy',              -- healthy, at_risk, declining, churned
  signals JSONB DEFAULT '{}'::jsonb,          -- individual signal scores
  -- signals shape: {
  --   order_frequency: { score, trend, current_interval_days, previous_interval_days },
  --   volume_trend: { score, trend, pct_change, periods_compared },
  --   sku_adoption: { score, active_skus, total_available, adoption_rate },
  --   reorder_consistency: { score, on_time_pct, avg_delay_days },
  --   revenue_trend: { score, trend, pct_change }
  -- }
  last_order_date TEXT,                       -- most recent order period
  days_since_order INTEGER,
  risk_factors JSONB DEFAULT '[]'::jsonb,     -- array of { factor, severity, detail }
  computed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_account_health_owner ON analyst_account_health(owner_id);
CREATE INDEX idx_account_health_dataset ON analyst_account_health(dataset_id);
CREATE INDEX idx_account_health_status ON analyst_account_health(status);
CREATE INDEX idx_account_health_score ON analyst_account_health(health_score);

ALTER TABLE analyst_account_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own account health" ON analyst_account_health
  FOR ALL USING (auth.uid() = owner_id);
