-- 00086: Fix agent_telemetry RLS — grant service_role full access.
-- Error: "permission denied for table agent_telemetry" from service role context.
-- The table has RLS enabled (00058) but no policies were created,
-- so even service_role was blocked.

-- Ensure RLS is enabled (idempotent)
ALTER TABLE agent_telemetry ENABLE ROW LEVEL SECURITY;

-- Allow service_role full CRUD — the beacon endpoint and rollup job both use admin client
CREATE POLICY "service_role_full_access"
  ON agent_telemetry
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to read their own telemetry
CREATE POLICY "users_read_own_telemetry"
  ON agent_telemetry
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

-- Allow authenticated users to insert telemetry for their own agents
CREATE POLICY "users_insert_own_telemetry"
  ON agent_telemetry
  FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid());
