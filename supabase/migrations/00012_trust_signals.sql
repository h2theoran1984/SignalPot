-- Sprint 13: Trust Graph v2 — External Signals + Statements

-- Trust signals table: verified external signals that feed into trust score
CREATE TABLE IF NOT EXISTS trust_signals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  signal_type  TEXT NOT NULL CHECK (signal_type IN (
                 'github_activity', 'agent_age', 'unique_callers', 'dispute_wins'
               )),
  value        NUMERIC NOT NULL DEFAULT 0,
  measured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, signal_type)
);

CREATE INDEX IF NOT EXISTS idx_trust_signals_agent ON trust_signals(agent_id);
CREATE INDEX IF NOT EXISTS idx_trust_signals_type ON trust_signals(signal_type);

ALTER TABLE trust_signals ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON trust_signals TO authenticated;
GRANT ALL ON trust_signals TO service_role;

-- Statements table: monthly activity summaries per profile
CREATE TABLE IF NOT EXISTS statements (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  period_start           DATE NOT NULL,
  period_end             DATE NOT NULL,
  total_jobs_as_requester INTEGER NOT NULL DEFAULT 0,
  total_jobs_as_provider  INTEGER NOT NULL DEFAULT 0,
  total_spent_millicents  BIGINT NOT NULL DEFAULT 0,
  total_earned_millicents BIGINT NOT NULL DEFAULT 0,
  total_fees_millicents   BIGINT NOT NULL DEFAULT 0,
  disputes_filed          INTEGER NOT NULL DEFAULT 0,
  disputes_won            INTEGER NOT NULL DEFAULT 0,
  generated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(profile_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_statements_profile ON statements(profile_id);
CREATE INDEX IF NOT EXISTS idx_statements_period ON statements(period_start DESC);

ALTER TABLE statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "statements_select_own" ON statements
  FOR SELECT USING (profile_id = auth.uid());
GRANT SELECT ON statements TO authenticated;
GRANT ALL ON statements TO service_role;
