-- 00088: Fix Middle Out RLS — grant table access to roles and fix policies

-- Grant table-level access
GRANT ALL ON middle_out_runs TO service_role;
GRANT SELECT, INSERT ON middle_out_runs TO authenticated;
GRANT SELECT ON middle_out_runs TO anon;

-- Drop and recreate policies with correct syntax
DROP POLICY IF EXISTS "service_role_full_access" ON middle_out_runs;
DROP POLICY IF EXISTS "users_read_own_runs" ON middle_out_runs;

CREATE POLICY "service_role_full_access" ON middle_out_runs
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "users_read_own_runs" ON middle_out_runs
  FOR SELECT TO authenticated
  USING (agent_id IN (SELECT id FROM agents WHERE owner_id = auth.uid()));

CREATE POLICY "anon_read_all" ON middle_out_runs
  FOR SELECT TO anon USING (true);
