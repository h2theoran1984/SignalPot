-- Add actual API cost columns to arena_matches.
-- cost_a/cost_b store the agent's rate (what they charge).
-- api_cost_a/api_cost_b store the actual LLM API cost (what it costs to run).

ALTER TABLE arena_matches ADD COLUMN IF NOT EXISTS api_cost_a NUMERIC DEFAULT 0;
ALTER TABLE arena_matches ADD COLUMN IF NOT EXISTS api_cost_b NUMERIC DEFAULT 0;
