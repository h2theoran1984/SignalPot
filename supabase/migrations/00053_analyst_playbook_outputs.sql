-- SignalPot Analyst Suite: Playbook outputs (Playbook agent)
-- Stores compiled sales-ready documents (account reviews, QBRs, territory plans, scorecards).

CREATE TABLE analyst_playbook_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  dataset_id UUID REFERENCES analyst_datasets(id) ON DELETE SET NULL,
  template_id UUID REFERENCES analyst_templates(id) ON DELETE SET NULL,
  output_type TEXT NOT NULL,                  -- account_review, qbr, territory_plan, scorecard
  title TEXT NOT NULL,
  entity_id UUID REFERENCES analyst_entities(id) ON DELETE SET NULL,  -- account if scoped
  account_name TEXT,
  content JSONB NOT NULL DEFAULT '{}'::jsonb, -- structured output content
  -- content shape varies by output_type:
  -- account_review: { summary, health, opportunities, risks, recommendations, metrics }
  -- qbr: { period, highlights, lowlights, pipeline, actions, forecast }
  -- territory_plan: { accounts: [{ name, health, priority, strategy }], targets, gaps }
  -- scorecard: { rep_name, metrics: { calls, meetings, revenue, quota_pct }, rankings }
  generated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_playbook_owner ON analyst_playbook_outputs(owner_id);
CREATE INDEX idx_playbook_type ON analyst_playbook_outputs(output_type);

ALTER TABLE analyst_playbook_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own playbook outputs" ON analyst_playbook_outputs
  FOR ALL USING (auth.uid() = owner_id);
