-- Add billing_notes column to arena_matches for audit trail of credit operation failures.
-- Stores JSONB array of { op, agent, amount, error } when add_credits calls fail.
ALTER TABLE arena_matches
ADD COLUMN IF NOT EXISTS billing_notes JSONB DEFAULT NULL;

COMMENT ON COLUMN arena_matches.billing_notes IS 'Audit trail for billing errors (failed provider credits or creator refunds)';
