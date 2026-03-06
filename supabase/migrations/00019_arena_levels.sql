-- 00019: Arena Levels — 3-level progression for the house agent.
-- Adds a level column to arena_matches (nullable for backward compatibility).
-- Level 1 = standard, Level 2 = enhanced, Level 3 = master.
-- ELO stays unified per-agent-per-capability — level only gates access.

ALTER TABLE arena_matches
  ADD COLUMN IF NOT EXISTS level SMALLINT;

CREATE INDEX IF NOT EXISTS idx_arena_matches_level
  ON arena_matches(level)
  WHERE level IS NOT NULL;
