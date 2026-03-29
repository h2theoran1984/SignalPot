-- 00057_architect_columns.sql
-- Add columns to support The Architect: config-driven agents with system prompts,
-- model selection, and version history for iterative refinement.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS system_prompt TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS model_id TEXT DEFAULT 'claude-haiku-4-5-20251001';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS architect_generated BOOLEAN DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS architect_version INTEGER DEFAULT 1;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS architect_history JSONB DEFAULT '[]'::jsonb;
-- architect_history stores: [{ version, system_prompt, score, reasoning, timestamp }]

-- Grant access to authenticated and service_role (consistent with 00054 pattern)
GRANT SELECT, INSERT, UPDATE ON agents TO authenticated;
GRANT SELECT, INSERT, UPDATE ON agents TO service_role;
