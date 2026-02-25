-- SignalPot MVP Schema
-- Graph-friendly relational schema for an AI agent marketplace

-- Custom enum types
CREATE TYPE rate_type AS ENUM ('per_call', 'per_task', 'per_hour');
CREATE TYPE auth_type AS ENUM ('api_key', 'oauth', 'mcp_token', 'none');
CREATE TYPE agent_status AS ENUM ('active', 'inactive', 'deprecated');
CREATE TYPE job_type AS ENUM ('production', 'staging', 'test');
CREATE TYPE job_status AS ENUM ('pending', 'running', 'completed', 'failed');

-- =============================================================
-- 1. profiles — Human users (GitHub OAuth)
-- =============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  github_username TEXT UNIQUE,
  email TEXT,
  avatar_url TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable by everyone"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- =============================================================
-- 2. agents — Registered AI agents (trust graph nodes)
-- =============================================================
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  capability_schema JSONB DEFAULT '[]'::jsonb,
  rate_type rate_type NOT NULL DEFAULT 'per_call',
  rate_amount NUMERIC NOT NULL DEFAULT 0,
  rate_currency TEXT NOT NULL DEFAULT 'USD',
  auth_type auth_type NOT NULL DEFAULT 'none',
  auth_config JSONB DEFAULT '{}'::jsonb,
  mcp_endpoint TEXT,
  tags TEXT[] DEFAULT '{}',
  status agent_status NOT NULL DEFAULT 'active',
  uptime_pct NUMERIC DEFAULT 100,
  avg_latency_ms INTEGER DEFAULT 0,
  rate_limit_rpm INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents are viewable by everyone"
  ON agents FOR SELECT
  USING (true);

CREATE POLICY "Owners can insert their own agents"
  ON agents FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can update their own agents"
  ON agents FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Owners can delete their own agents"
  ON agents FOR DELETE
  USING (auth.uid() = owner_id);

-- Indexes for agents
CREATE INDEX idx_agents_tags ON agents USING GIN (tags);
CREATE INDEX idx_agents_capability_schema ON agents USING GIN (capability_schema);
CREATE INDEX idx_agents_owner_id ON agents (owner_id);
CREATE INDEX idx_agents_status ON agents (status);

-- =============================================================
-- 3. jobs — Completed work (trust graph edges)
-- =============================================================
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  provider_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  requester_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  job_type job_type NOT NULL DEFAULT 'production',
  capability_used TEXT,
  input_summary JSONB,
  output_summary JSONB,
  status job_status NOT NULL DEFAULT 'pending',
  duration_ms INTEGER,
  cost NUMERIC DEFAULT 0,
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Jobs are viewable by everyone"
  ON jobs FOR SELECT
  USING (true);

CREATE POLICY "Participants can insert jobs"
  ON jobs FOR INSERT
  WITH CHECK (
    auth.uid() = requester_profile_id
    OR auth.uid() IN (
      SELECT owner_id FROM agents WHERE id = requester_agent_id
    )
    OR auth.uid() IN (
      SELECT owner_id FROM agents WHERE id = provider_agent_id
    )
  );

-- Indexes for jobs
CREATE INDEX idx_jobs_provider ON jobs (provider_agent_id);
CREATE INDEX idx_jobs_requester_agent ON jobs (requester_agent_id);
CREATE INDEX idx_jobs_requester_profile ON jobs (requester_profile_id);
CREATE INDEX idx_jobs_status ON jobs (status);

-- =============================================================
-- 4. trust_edges — Materialized trust graph edges
-- =============================================================
CREATE TABLE trust_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  target_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  total_jobs INTEGER NOT NULL DEFAULT 0,
  successful_jobs INTEGER NOT NULL DEFAULT 0,
  production_jobs INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER DEFAULT 0,
  last_job_at TIMESTAMPTZ,
  trust_score NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (source_agent_id, target_agent_id)
);

ALTER TABLE trust_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trust edges are viewable by everyone"
  ON trust_edges FOR SELECT
  USING (true);

-- Index for trust_edges
CREATE INDEX idx_trust_edges_source_target ON trust_edges (source_agent_id, target_agent_id);
CREATE INDEX idx_trust_edges_target ON trust_edges (target_agent_id);

-- =============================================================
-- Trigger: auto-update updated_at on profiles
-- =============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- Trigger: auto-create profile on new user signup
-- =============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, github_username, email, avatar_url, display_name)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'user_name',
    NEW.email,
    NEW.raw_user_meta_data ->> 'avatar_url',
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'user_name')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================================
-- Function: Update trust edges after job completion
-- =============================================================
CREATE OR REPLACE FUNCTION update_trust_edge_on_job()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND NEW.requester_agent_id IS NOT NULL THEN
    INSERT INTO trust_edges (source_agent_id, target_agent_id, total_jobs, successful_jobs, production_jobs, total_spent, avg_latency_ms, last_job_at, trust_score)
    VALUES (
      NEW.requester_agent_id,
      NEW.provider_agent_id,
      1,
      1,
      CASE WHEN NEW.job_type = 'production' THEN 1 ELSE 0 END,
      COALESCE(NEW.cost, 0),
      COALESCE(NEW.duration_ms, 0),
      now(),
      CASE WHEN NEW.job_type = 'production' THEN 1.0 ELSE 0.5 END
    )
    ON CONFLICT (source_agent_id, target_agent_id) DO UPDATE SET
      total_jobs = trust_edges.total_jobs + 1,
      successful_jobs = trust_edges.successful_jobs + 1,
      production_jobs = trust_edges.production_jobs + CASE WHEN NEW.job_type = 'production' THEN 1 ELSE 0 END,
      total_spent = trust_edges.total_spent + COALESCE(NEW.cost, 0),
      avg_latency_ms = (trust_edges.avg_latency_ms * trust_edges.total_jobs + COALESCE(NEW.duration_ms, 0)) / (trust_edges.total_jobs + 1),
      last_job_at = now(),
      trust_score = (trust_edges.successful_jobs + 1)::NUMERIC / (trust_edges.total_jobs + 1)
        * (1 + 0.5 * ((trust_edges.production_jobs + CASE WHEN NEW.job_type = 'production' THEN 1 ELSE 0 END)::NUMERIC / GREATEST(trust_edges.total_jobs + 1, 1)));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_job_completed
  AFTER UPDATE ON jobs
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status != 'completed')
  EXECUTE FUNCTION update_trust_edge_on_job();
