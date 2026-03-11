-- Fix infinite recursion in org_members RLS policies.
--
-- Problem: org_members SELECT policy does
--   SELECT org_id FROM org_members WHERE profile_id = auth.uid()
-- which triggers its own SELECT policy, causing infinite recursion.
-- Every other table that queries org_members in a policy also hits this.
--
-- Solution: SECURITY DEFINER helper that bypasses RLS when resolving
-- the caller's org memberships. All affected policies are rewritten.

-- ============================================================
-- 1. Helper function — runs as definer, skips RLS on org_members
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_org_ids(allowed_roles text[] DEFAULT NULL)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id
  FROM org_members
  WHERE profile_id = auth.uid()
    AND (allowed_roles IS NULL OR role::text = ANY(allowed_roles));
$$;

-- ============================================================
-- 2. org_members policies (from 00022)
-- ============================================================
DROP POLICY IF EXISTS "Members can view co-members" ON org_members;
CREATE POLICY "Members can view co-members"
  ON org_members FOR SELECT
  USING (
    org_id IN (SELECT get_my_org_ids())
  );

DROP POLICY IF EXISTS "Admins can add members" ON org_members;
CREATE POLICY "Admins can add members"
  ON org_members FOR INSERT
  WITH CHECK (
    org_id IN (SELECT get_my_org_ids(ARRAY['owner', 'admin']))
    OR (auth.uid() = profile_id AND role = 'owner')
  );

DROP POLICY IF EXISTS "Admins can update member roles" ON org_members;
CREATE POLICY "Admins can update member roles"
  ON org_members FOR UPDATE
  USING (
    org_id IN (SELECT get_my_org_ids(ARRAY['owner', 'admin']))
  );

DROP POLICY IF EXISTS "Admins can remove members" ON org_members;
CREATE POLICY "Admins can remove members"
  ON org_members FOR DELETE
  USING (
    org_id IN (SELECT get_my_org_ids(ARRAY['owner', 'admin']))
  );

-- ============================================================
-- 3. organizations policies (from 00022)
-- ============================================================
DROP POLICY IF EXISTS "Org members can view their orgs" ON organizations;
CREATE POLICY "Org members can view their orgs"
  ON organizations FOR SELECT
  USING (
    id IN (SELECT get_my_org_ids())
  );

DROP POLICY IF EXISTS "Org owners can update their org" ON organizations;
CREATE POLICY "Org owners can update their org"
  ON organizations FOR UPDATE
  USING (
    id IN (SELECT get_my_org_ids(ARRAY['owner']))
  );

-- ============================================================
-- 4. agents policies (SELECT from 00026, INSERT/UPDATE/DELETE from 00023)
-- ============================================================
DROP POLICY IF EXISTS "Agents are viewable by everyone" ON agents;
DROP POLICY IF EXISTS "Public can view agent public fields" ON agents;
DROP POLICY IF EXISTS "Public agents viewable by everyone, private by org members" ON agents;
CREATE POLICY "Public agents viewable by everyone, private by org members"
  ON agents FOR SELECT
  USING (
    visibility = 'public'
    OR (
      visibility = 'private'
      AND org_id IS NOT NULL
      AND org_id IN (SELECT get_my_org_ids())
    )
    OR owner_id = auth.uid()
  );

DROP POLICY IF EXISTS "Users or org developers can insert agents" ON agents;
CREATE POLICY "Users or org developers can insert agents"
  ON agents FOR INSERT
  WITH CHECK (
    (org_id IS NULL AND auth.uid() = owner_id)
    OR
    (org_id IS NOT NULL AND auth.uid() = owner_id
     AND org_id IN (SELECT get_my_org_ids(ARRAY['owner', 'admin', 'developer'])))
  );

DROP POLICY IF EXISTS "Owners or org developers can update agents" ON agents;
CREATE POLICY "Owners or org developers can update agents"
  ON agents FOR UPDATE
  USING (
    (org_id IS NULL AND auth.uid() = owner_id)
    OR
    (org_id IS NOT NULL
     AND org_id IN (SELECT get_my_org_ids(ARRAY['owner', 'admin', 'developer'])))
  );

DROP POLICY IF EXISTS "Owners or org admins can delete agents" ON agents;
CREATE POLICY "Owners or org admins can delete agents"
  ON agents FOR DELETE
  USING (
    (org_id IS NULL AND auth.uid() = owner_id)
    OR
    (org_id IS NOT NULL
     AND org_id IN (SELECT get_my_org_ids(ARRAY['owner', 'admin'])))
  );

-- ============================================================
-- 5. api_keys policies (from 00023)
-- ============================================================
DROP POLICY IF EXISTS "Users can view own or org api keys" ON api_keys;
CREATE POLICY "Users can view own or org api keys"
  ON api_keys FOR SELECT
  USING (
    (org_id IS NULL AND auth.uid() = profile_id)
    OR
    (org_id IS NOT NULL AND org_id IN (SELECT get_my_org_ids()))
  );

DROP POLICY IF EXISTS "Users can insert own or org api keys" ON api_keys;
CREATE POLICY "Users can insert own or org api keys"
  ON api_keys FOR INSERT
  WITH CHECK (
    (org_id IS NULL AND auth.uid() = profile_id)
    OR
    (org_id IS NOT NULL AND auth.uid() = profile_id
     AND org_id IN (SELECT get_my_org_ids(ARRAY['owner', 'admin', 'developer'])))
  );

DROP POLICY IF EXISTS "Users can update own or org api keys" ON api_keys;
CREATE POLICY "Users can update own or org api keys"
  ON api_keys FOR UPDATE
  USING (
    (org_id IS NULL AND auth.uid() = profile_id)
    OR
    (org_id IS NOT NULL
     AND org_id IN (SELECT get_my_org_ids(ARRAY['owner', 'admin'])))
  );

DROP POLICY IF EXISTS "Users can delete own or org api keys" ON api_keys;
CREATE POLICY "Users can delete own or org api keys"
  ON api_keys FOR DELETE
  USING (
    (org_id IS NULL AND auth.uid() = profile_id)
    OR
    (org_id IS NOT NULL
     AND org_id IN (SELECT get_my_org_ids(ARRAY['owner', 'admin'])))
  );

-- ============================================================
-- 6. audit_log SELECT policy (from 00022)
-- ============================================================
DROP POLICY IF EXISTS "Org members can view audit logs" ON audit_log;
CREATE POLICY "Org members can view audit logs"
  ON audit_log FOR SELECT
  USING (
    org_id IN (SELECT get_my_org_ids())
  );
