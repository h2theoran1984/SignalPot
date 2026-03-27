-- SignalPot Analyst Suite: Reusable output templates for Brief
-- Stores named JSON template definitions that drive report/slide/table/chart compilation.

CREATE TABLE analyst_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  output_type TEXT NOT NULL,                  -- report, slide, table, chart
  params JSONB NOT NULL DEFAULT '{}'::jsonb,  -- full template parameter definition
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(owner_id, name)
);

ALTER TABLE analyst_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own templates" ON analyst_templates
  FOR ALL USING (auth.uid() = owner_id);

-- Example template params by output_type:
--
-- report: {
--   "sections": ["executive_summary", "market_overview", "competitive_landscape", "recommendations"],
--   "metrics": ["unit_share", "dollar_share", "growth_rate"],
--   "group_by": "brand",
--   "period_compare": true,
--   "include_charts": true,
--   "tone": "executive"
-- }
--
-- slide: {
--   "slide_count": 10,
--   "slides": [
--     { "type": "title", "content": "{{title}}" },
--     { "type": "kpi_grid", "metrics": ["unit_share", "growth_rate"], "top_n": 5 },
--     { "type": "chart", "chart_type": "bar", "metric": "unit_share", "group_by": "brand" },
--     { "type": "table", "dimensions": ["brand", "region"], "metrics": ["volume"] },
--     { "type": "takeaways", "count": 3 }
--   ],
--   "theme": "dark"
-- }
--
-- table: {
--   "dimensions": ["brand", "region"],
--   "metrics": ["unit_share", "dollar_share", "volume"],
--   "sort_by": "unit_share",
--   "sort_dir": "desc",
--   "top_n": 20,
--   "include_totals": true,
--   "include_pct_change": true
-- }
--
-- chart: {
--   "chart_type": "bar",
--   "x": "brand",
--   "y": "unit_share",
--   "group_by": "region",
--   "top_n": 10,
--   "show_labels": true,
--   "color_scheme": "categorical"
-- }
