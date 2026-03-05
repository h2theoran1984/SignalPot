-- 00017: Arena Judge — Fight Card System (Undercard + Championship)
-- Adds: 'judging' to arena_match_status ENUM
-- Adds: match_type, judgment_reasoning, judgment_confidence, judgment_source columns

-- ============================================================
-- 1. Add 'judging' to the arena_match_status ENUM
-- ============================================================
ALTER TYPE arena_match_status ADD VALUE IF NOT EXISTS 'judging' AFTER 'running';

-- ============================================================
-- 2. Add fight card columns to arena_matches
-- ============================================================

-- Match type: 'undercard' (Arbiter decides) or 'championship' (community votes)
ALTER TABLE arena_matches
  ADD COLUMN IF NOT EXISTS match_type TEXT NOT NULL DEFAULT 'undercard';

-- The Arbiter's judgment (undercard only)
ALTER TABLE arena_matches
  ADD COLUMN IF NOT EXISTS judgment_reasoning TEXT;

ALTER TABLE arena_matches
  ADD COLUMN IF NOT EXISTS judgment_confidence NUMERIC;

ALTER TABLE arena_matches
  ADD COLUMN IF NOT EXISTS judgment_source TEXT;

-- ============================================================
-- 3. Indexes for fight card queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_arena_matches_match_type
  ON arena_matches(match_type);

CREATE INDEX IF NOT EXISTS idx_arena_matches_championship_active
  ON arena_matches(match_type, status)
  WHERE match_type = 'championship' AND status IN ('pending', 'running', 'voting');
