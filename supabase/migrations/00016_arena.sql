-- 00016: Arena — Agent-vs-Agent Competition System
-- Adds: arena_matches, arena_votes, arena_ratings, arena_challenges tables
-- Adds: arena_match_status ENUM

-- ============================================================
-- 1. Custom types
-- ============================================================
CREATE TYPE arena_match_status AS ENUM (
  'pending',      -- match created, not started
  'running',      -- both agents being called in parallel
  'voting',       -- responses received, voting open
  'completed',    -- winner determined
  'failed'        -- one or both agents failed
);

-- ============================================================
-- 2. arena_challenges — library of prompts
-- ============================================================
CREATE TABLE arena_challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  capability      TEXT NOT NULL,
  prompt          JSONB NOT NULL,
  difficulty      TEXT NOT NULL DEFAULT 'medium'
                  CHECK (difficulty IN ('easy', 'medium', 'hard')),
  tags            TEXT[] DEFAULT '{}',
  featured        BOOLEAN NOT NULL DEFAULT false,
  featured_week   DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_arena_challenges_capability ON arena_challenges(capability);
CREATE INDEX idx_arena_challenges_featured ON arena_challenges(featured)
  WHERE featured = true;

-- ============================================================
-- 3. arena_matches — head-to-head matches
-- ============================================================
CREATE TABLE arena_matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- The two competing agents
  agent_a_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agent_b_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,

  -- The challenge/prompt
  challenge_id    UUID REFERENCES arena_challenges(id) ON DELETE SET NULL,
  capability      TEXT NOT NULL,
  prompt          JSONB NOT NULL,
  prompt_text     TEXT,

  -- Job records (created when match starts)
  job_a_id        UUID REFERENCES jobs(id) ON DELETE SET NULL,
  job_b_id        UUID REFERENCES jobs(id) ON DELETE SET NULL,

  -- Responses (stored when agents complete)
  response_a      JSONB,
  response_b      JSONB,
  duration_a_ms   INTEGER,
  duration_b_ms   INTEGER,
  verified_a      BOOLEAN,
  verified_b      BOOLEAN,

  -- Match state
  status          arena_match_status NOT NULL DEFAULT 'pending',
  winner          TEXT CHECK (winner IN ('a', 'b', 'tie')),

  -- Voting
  votes_a         INTEGER NOT NULL DEFAULT 0,
  votes_b         INTEGER NOT NULL DEFAULT 0,
  votes_tie       INTEGER NOT NULL DEFAULT 0,
  voting_ends_at  TIMESTAMPTZ,

  -- Cost tracking
  cost_a          NUMERIC DEFAULT 0,
  cost_b          NUMERIC DEFAULT 0,

  -- Timestamps
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT arena_matches_different_agents CHECK (agent_a_id != agent_b_id)
);

CREATE INDEX idx_arena_matches_status ON arena_matches(status);
CREATE INDEX idx_arena_matches_agent_a ON arena_matches(agent_a_id);
CREATE INDEX idx_arena_matches_agent_b ON arena_matches(agent_b_id);
CREATE INDEX idx_arena_matches_creator ON arena_matches(creator_id);
CREATE INDEX idx_arena_matches_created ON arena_matches(created_at DESC);
CREATE INDEX idx_arena_matches_capability ON arena_matches(capability);

-- ============================================================
-- 4. arena_votes — one vote per user per match
-- ============================================================
CREATE TABLE arena_votes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        UUID NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  voter_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vote            TEXT NOT NULL CHECK (vote IN ('a', 'b', 'tie')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (match_id, voter_id)
);

CREATE INDEX idx_arena_votes_match ON arena_votes(match_id);
CREATE INDEX idx_arena_votes_voter ON arena_votes(voter_id);

-- ============================================================
-- 5. arena_ratings — ELO ratings per agent per capability
-- ============================================================
CREATE TABLE arena_ratings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability      TEXT NOT NULL,
  elo             INTEGER NOT NULL DEFAULT 1200,
  matches_played  INTEGER NOT NULL DEFAULT 0,
  wins            INTEGER NOT NULL DEFAULT 0,
  losses          INTEGER NOT NULL DEFAULT 0,
  ties            INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (agent_id, capability)
);

CREATE INDEX idx_arena_ratings_elo ON arena_ratings(elo DESC);
CREATE INDEX idx_arena_ratings_agent ON arena_ratings(agent_id);
CREATE INDEX idx_arena_ratings_capability ON arena_ratings(capability);

-- ============================================================
-- 6. RLS Policies
-- ============================================================
ALTER TABLE arena_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_ratings ENABLE ROW LEVEL SECURITY;

-- Challenges: public read
CREATE POLICY "arena_challenges_public_read" ON arena_challenges
  FOR SELECT USING (true);

-- Matches: public read (spectating)
CREATE POLICY "arena_matches_public_read" ON arena_matches
  FOR SELECT USING (true);

-- Matches: authenticated users can create
CREATE POLICY "arena_matches_insert_auth" ON arena_matches
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

-- Votes: public read
CREATE POLICY "arena_votes_public_read" ON arena_votes
  FOR SELECT USING (true);

-- Votes: authenticated users can insert their own
CREATE POLICY "arena_votes_insert_auth" ON arena_votes
  FOR INSERT WITH CHECK (auth.uid() = voter_id);

-- Ratings: public read
CREATE POLICY "arena_ratings_public_read" ON arena_ratings
  FOR SELECT USING (true);

-- ============================================================
-- 7. Grants
-- ============================================================
GRANT SELECT ON arena_challenges TO anon, authenticated;
GRANT ALL ON arena_challenges TO service_role;

GRANT SELECT ON arena_matches TO anon, authenticated;
GRANT INSERT ON arena_matches TO authenticated;
GRANT ALL ON arena_matches TO service_role;

GRANT SELECT ON arena_votes TO anon, authenticated;
GRANT INSERT ON arena_votes TO authenticated;
GRANT ALL ON arena_votes TO service_role;

GRANT SELECT ON arena_ratings TO anon, authenticated;
GRANT ALL ON arena_ratings TO service_role;
