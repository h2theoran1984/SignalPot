-- Sprint 11: Dispute Resolution — Tiers 2 & 3
-- Creates dispute_panel_votes table and adds is_admin to profiles

CREATE TABLE IF NOT EXISTS dispute_panel_votes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id    UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  vote          TEXT NOT NULL CHECK (vote IN ('upheld', 'rejected')),
  reasoning     TEXT,
  voted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(dispute_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_panel_votes_dispute ON dispute_panel_votes(dispute_id);

ALTER TABLE dispute_panel_votes ENABLE ROW LEVEL SECURITY;
-- Panel votes are read by service_role only (internal use)
GRANT ALL ON dispute_panel_votes TO service_role;

-- Add is_admin flag to profiles (for Tier 3 admin access)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
