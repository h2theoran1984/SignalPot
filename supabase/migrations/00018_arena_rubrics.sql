-- 00018: Arena Rubrics — Domain-specific judging + anti-gaming task templates
-- Adds: rubric, task_variables, template_prompt to arena_challenges
-- Adds: resolved_prompt, judgment_breakdown to arena_matches

-- ============================================================
-- 1. Add rubric + template columns to arena_challenges
-- ============================================================

-- Domain-specific rubric (criteria, weights, speed tiers)
ALTER TABLE arena_challenges
  ADD COLUMN IF NOT EXISTS rubric JSONB;

-- Variable pools for anti-gaming template resolution
ALTER TABLE arena_challenges
  ADD COLUMN IF NOT EXISTS task_variables JSONB;

-- Prompt template with {{variable}} placeholders
ALTER TABLE arena_challenges
  ADD COLUMN IF NOT EXISTS template_prompt JSONB;

-- ============================================================
-- 2. Add resolved prompt + judgment breakdown to arena_matches
-- ============================================================

-- The concrete prompt after template resolution (for audit)
ALTER TABLE arena_matches
  ADD COLUMN IF NOT EXISTS resolved_prompt JSONB;

-- Per-criterion scoring breakdown from The Arbiter
ALTER TABLE arena_matches
  ADD COLUMN IF NOT EXISTS judgment_breakdown JSONB;
