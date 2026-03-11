-- D6.2: Private Agent Registries
-- Add visibility column so orgs can have private agents not shown on the public marketplace.

-- Add visibility column: 'public' (default, appears in marketplace) or 'private' (org-only)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_visibility_check'
  ) THEN
    ALTER TABLE agents ADD CONSTRAINT agents_visibility_check
      CHECK (visibility IN ('public', 'private'));
  END IF;
END $$;

-- Update RLS: public agents visible to all, private agents only to org members
DROP POLICY IF EXISTS "Agents are viewable by everyone" ON agents;
DROP POLICY IF EXISTS "Public agents viewable by everyone, private by org members" ON agents;

CREATE POLICY "Public agents viewable by everyone, private by org members"
  ON agents FOR SELECT
  USING (
    visibility = 'public'
    OR (
      visibility = 'private'
      AND org_id IS NOT NULL
      AND org_id IN (
        SELECT org_id FROM org_members WHERE profile_id = auth.uid()
      )
    )
    OR owner_id = auth.uid()
  );
