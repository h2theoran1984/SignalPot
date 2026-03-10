-- Enterprise Phase 1: Organizations, members, audit log
-- This migration is purely ADDITIVE — no existing tables or policies are modified.

-- ============================================================
-- 1. Org role enum
-- ============================================================
CREATE TYPE org_role AS ENUM ('owner', 'admin', 'developer', 'viewer', 'auditor');

-- ============================================================
-- 2. Organizations table
-- ============================================================
CREATE TABLE organizations (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      TEXT        NOT NULL,
  slug                      TEXT        NOT NULL UNIQUE,
  avatar_url                TEXT,
  created_by                UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan                      plan_type   NOT NULL DEFAULT 'team',
  stripe_customer_id        TEXT        UNIQUE,
  stripe_subscription_id    TEXT        UNIQUE,
  credit_balance_millicents BIGINT      NOT NULL DEFAULT 0,
  settings                  JSONB       NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view their orgs"
  ON organizations FOR SELECT
  USING (
    id IN (SELECT org_id FROM org_members WHERE profile_id = auth.uid())
  );

CREATE POLICY "Org owners can update their org"
  ON organizations FOR UPDATE
  USING (
    id IN (
      SELECT org_id FROM org_members
      WHERE profile_id = auth.uid() AND role = 'owner'
    )
  );

-- Anyone authenticated can create an org (they become the owner)
CREATE POLICY "Authenticated users can create orgs"
  ON organizations FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- ============================================================
-- 3. Org members table
-- ============================================================
CREATE TABLE org_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        org_role    NOT NULL DEFAULT 'developer',
  invited_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, profile_id)
);

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- Members can see their co-members
CREATE POLICY "Members can view co-members"
  ON org_members FOR SELECT
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE profile_id = auth.uid())
  );

-- Admins+ can add members
CREATE POLICY "Admins can add members"
  ON org_members FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE profile_id = auth.uid() AND role IN ('owner', 'admin')
    )
    -- Also allow: the org creator inserting themselves as owner during org creation
    OR (auth.uid() = profile_id AND role = 'owner')
  );

-- Admins+ can update member roles
CREATE POLICY "Admins can update member roles"
  ON org_members FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE profile_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Admins+ can remove members (owner removal prevented in application code)
CREATE POLICY "Admins can remove members"
  ON org_members FOR DELETE
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE profile_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Performance index for RLS subqueries (every org-scoped policy hits this)
CREATE INDEX idx_org_members_profile ON org_members(profile_id);
CREATE INDEX idx_org_members_org ON org_members(org_id);

-- ============================================================
-- 4. Audit log table (append-only)
-- ============================================================
CREATE TABLE audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        REFERENCES organizations(id) ON DELETE SET NULL,
  actor_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action      TEXT        NOT NULL,
  target_type TEXT,
  target_id   UUID,
  metadata    JSONB       NOT NULL DEFAULT '{}',
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Org members can read their org's audit log
CREATE POLICY "Org members can view audit logs"
  ON audit_log FOR SELECT
  USING (
    org_id IN (SELECT org_id FROM org_members WHERE profile_id = auth.uid())
  );

-- No user-facing INSERT policy — writes go through service_role only

CREATE INDEX idx_audit_log_org_time ON audit_log(org_id, created_at DESC);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_id);

-- ============================================================
-- 5. Add nullable org_id to existing tables
--    Existing rows get NULL (personal context, unchanged behavior)
-- ============================================================
ALTER TABLE agents
  ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE api_keys
  ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE arena_matches
  ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX idx_agents_org ON agents(org_id);
CREATE INDEX idx_api_keys_org ON api_keys(org_id);
CREATE INDEX idx_arena_matches_org ON arena_matches(org_id);

-- ============================================================
-- 6. Grants
-- ============================================================
GRANT ALL ON organizations TO authenticated;
GRANT ALL ON org_members TO authenticated;
GRANT SELECT ON audit_log TO authenticated;

GRANT ALL ON organizations TO service_role;
GRANT ALL ON org_members TO service_role;
GRANT ALL ON audit_log TO service_role;
