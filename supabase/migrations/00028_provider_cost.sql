-- Track agent-reported API costs for margin analysis
-- Agents can self-report their upstream API cost (e.g., what they pay their LLM provider)
-- via _meta.provider_cost in their A2A response.

ALTER TABLE jobs ADD COLUMN provider_cost NUMERIC DEFAULT NULL;

COMMENT ON COLUMN jobs.provider_cost IS 'Agent self-reported upstream API cost in USD (e.g., LLM provider cost)';
