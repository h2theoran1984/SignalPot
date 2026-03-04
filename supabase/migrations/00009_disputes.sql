-- Sprint 10: Dispute Resolution — Tier 1
-- Creates disputes and dispute_deposits tables

CREATE TABLE IF NOT EXISTS disputes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  filed_by_profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason                TEXT NOT NULL,
  evidence              JSONB,
  tier                  INTEGER NOT NULL DEFAULT 1 CHECK (tier IN (1, 2, 3)),
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'appealed')),
  resolution            TEXT CHECK (resolution IN ('upheld', 'rejected', 'partial')),
  filed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at           TIMESTAMPTZ,
  resolver_notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_disputes_job ON disputes(job_id);
CREATE INDEX IF NOT EXISTS idx_disputes_filed_by ON disputes(filed_by_profile_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status) WHERE status != 'resolved';

CREATE TABLE IF NOT EXISTS dispute_deposits (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id            UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  profile_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount_millicents     BIGINT NOT NULL CHECK (amount_millicents > 0),
  status                TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'returned', 'forfeited')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispute_deposits_dispute ON dispute_deposits(dispute_id);
CREATE INDEX IF NOT EXISTS idx_dispute_deposits_profile ON dispute_deposits(profile_id);

-- RLS
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "disputes_select_own" ON disputes
  FOR SELECT USING (filed_by_profile_id = auth.uid());

CREATE POLICY "dispute_deposits_select_own" ON dispute_deposits
  FOR SELECT USING (profile_id = auth.uid());

GRANT SELECT ON disputes TO authenticated;
GRANT SELECT ON dispute_deposits TO authenticated;
GRANT ALL ON disputes TO service_role;
GRANT ALL ON dispute_deposits TO service_role;
