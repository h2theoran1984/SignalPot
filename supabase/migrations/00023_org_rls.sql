-- Enterprise Phase 1: Update existing RLS policies for org-scoped access.
-- All changes are DROP + RECREATE in a single transaction.
-- The (org_id IS NULL AND auth.uid() = owner_id) path preserves existing behavior.

-- ============================================================
-- 1. Agents — INSERT policy
-- ============================================================
DROP POLICY IF EXISTS "Owners can insert their own agents" ON agents;

CREATE POLICY "Users or org developers can insert agents"
  ON agents FOR INSERT
  WITH CHECK (
    -- Personal agent: same as before
    (org_id IS NULL AND auth.uid() = owner_id)
    OR
    -- Org agent: must be developer+ in the same org
    (org_id IS NOT NULL AND auth.uid() = owner_id AND org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.profile_id = auth.uid() AND om.role IN ('owner', 'admin', 'developer')
    ))
  );

-- ============================================================
-- 2. Agents — UPDATE policy
-- ============================================================
DROP POLICY IF EXISTS "Owners can update their own agents" ON agents;

CREATE POLICY "Owners or org developers can update agents"
  ON agents FOR UPDATE
  USING (
    (org_id IS NULL AND auth.uid() = owner_id)
    OR
    (org_id IS NOT NULL AND org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.profile_id = auth.uid() AND om.role IN ('owner', 'admin', 'developer')
    ))
  );

-- ============================================================
-- 3. Agents — DELETE policy
-- ============================================================
DROP POLICY IF EXISTS "Owners can delete their own agents" ON agents;

CREATE POLICY "Owners or org admins can delete agents"
  ON agents FOR DELETE
  USING (
    (org_id IS NULL AND auth.uid() = owner_id)
    OR
    (org_id IS NOT NULL AND org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.profile_id = auth.uid() AND om.role IN ('owner', 'admin')
    ))
  );

-- ============================================================
-- 4. API Keys — extend for org-scoped keys
--    Existing policies check profile_id = auth.uid().
--    We extend to also allow org key access for members.
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own api keys" ON api_keys;

CREATE POLICY "Users can view own or org api keys"
  ON api_keys FOR SELECT
  USING (
    (org_id IS NULL AND auth.uid() = profile_id)
    OR
    (org_id IS NOT NULL AND org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.profile_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "Users can insert their own api keys" ON api_keys;

CREATE POLICY "Users can insert own or org api keys"
  ON api_keys FOR INSERT
  WITH CHECK (
    (org_id IS NULL AND auth.uid() = profile_id)
    OR
    (org_id IS NOT NULL AND auth.uid() = profile_id AND org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.profile_id = auth.uid() AND om.role IN ('owner', 'admin', 'developer')
    ))
  );

DROP POLICY IF EXISTS "Users can update their own api keys" ON api_keys;

CREATE POLICY "Users can update own or org api keys"
  ON api_keys FOR UPDATE
  USING (
    (org_id IS NULL AND auth.uid() = profile_id)
    OR
    (org_id IS NOT NULL AND org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.profile_id = auth.uid() AND om.role IN ('owner', 'admin')
    ))
  );

DROP POLICY IF EXISTS "Users can delete their own api keys" ON api_keys;

CREATE POLICY "Users can delete own or org api keys"
  ON api_keys FOR DELETE
  USING (
    (org_id IS NULL AND auth.uid() = profile_id)
    OR
    (org_id IS NOT NULL AND org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.profile_id = auth.uid() AND om.role IN ('owner', 'admin')
    ))
  );
