-- 00056: A2A Push Notification Configs + Task Lifecycle Support
-- Adds: a2a_push_notification_configs table, context_id + canceled status for jobs

-- ============================================================
-- 1. Push Notification Configs — A2A spec tasks/pushNotificationConfig/*
-- ============================================================
CREATE TABLE a2a_push_notification_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,                    -- webhook endpoint
  token           TEXT,                             -- optional auth token for webhook
  event_types     TEXT[] DEFAULT '{}',              -- filter: empty = all events
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One config per (task, url) pair
  UNIQUE (task_id, url)
);

CREATE INDEX idx_a2a_push_configs_task ON a2a_push_notification_configs(task_id);

-- ============================================================
-- 2. Add 'canceled' to job_status enum
-- ============================================================
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'canceled' AFTER 'failed';

-- ============================================================
-- 3. Add context_id to jobs for A2A session grouping
-- ============================================================
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS context_id UUID;
CREATE INDEX idx_jobs_context ON jobs(context_id) WHERE context_id IS NOT NULL;

-- ============================================================
-- 4. Add 'judging' to arena_match_status if not present
-- ============================================================
ALTER TYPE arena_match_status ADD VALUE IF NOT EXISTS 'judging' AFTER 'running';

-- ============================================================
-- 5. RLS + Grants
-- ============================================================
ALTER TABLE a2a_push_notification_configs ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by engine/handler)
GRANT ALL ON a2a_push_notification_configs TO service_role;

-- Authenticated users can view their own configs (via job ownership)
CREATE POLICY "push_configs_select_own" ON a2a_push_notification_configs
  FOR SELECT USING (
    task_id IN (
      SELECT id FROM jobs WHERE requester_profile_id = auth.uid()
    )
  );

CREATE POLICY "push_configs_insert_own" ON a2a_push_notification_configs
  FOR INSERT WITH CHECK (
    task_id IN (
      SELECT id FROM jobs WHERE requester_profile_id = auth.uid()
    )
  );

CREATE POLICY "push_configs_delete_own" ON a2a_push_notification_configs
  FOR DELETE USING (
    task_id IN (
      SELECT id FROM jobs WHERE requester_profile_id = auth.uid()
    )
  );
