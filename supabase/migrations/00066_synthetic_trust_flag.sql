-- Flag for synthetic/demo trust edges — excluded from public agent cards
ALTER TABLE trust_edges ADD COLUMN IF NOT EXISTS synthetic BOOLEAN DEFAULT false;

-- Mark all recently created edges as synthetic
UPDATE trust_edges SET synthetic = true
WHERE updated_at > now() - interval '1 hour'
AND source_agent_id != target_agent_id;
