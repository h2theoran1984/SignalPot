-- 00085: Constraint Challenge Sets for AutoTune v2
-- Cached, reusable challenge sets keyed by capability domain + level.
-- Generated once, used by ALL agents — enables comparable scoring
-- across the talent pool.

CREATE TABLE constraint_challenge_sets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability    TEXT NOT NULL,                    -- e.g. "signalpot/meeting-summary@v1" or domain like "text-processing"
  level         INTEGER NOT NULL DEFAULT 1,
  challenges    JSONB NOT NULL,                   -- Array of {title, prompt, constraints[], speed_threshold_ms, token_budget}
  challenge_count INTEGER NOT NULL DEFAULT 0,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  training_goal TEXT,                             -- Optional goal that influenced generation
  factor_weights JSONB,                           -- Weights used during generation
  stale         BOOLEAN NOT NULL DEFAULT false,

  UNIQUE(capability, level)
);

CREATE INDEX idx_constraint_sets_capability ON constraint_challenge_sets (capability, level, stale);
