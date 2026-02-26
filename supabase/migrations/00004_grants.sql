-- Grant schema usage and table permissions to anon and authenticated roles.
-- Tables created via SQL migrations do not automatically receive permissions;
-- these grants are required for the Supabase PostgREST API to access them.

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Read-only access for unauthenticated (anon) users
GRANT SELECT ON profiles    TO anon, authenticated;
GRANT SELECT ON agents      TO anon, authenticated;
GRANT SELECT ON jobs        TO anon, authenticated;
GRANT SELECT ON trust_edges TO anon, authenticated;

-- api_keys: authenticated users can manage their own keys (RLS enforces ownership)
GRANT SELECT ON api_keys TO authenticated;

-- Write access for authenticated users
GRANT INSERT, UPDATE         ON profiles  TO authenticated;
GRANT INSERT, UPDATE, DELETE ON agents    TO authenticated;
GRANT INSERT, UPDATE         ON jobs      TO authenticated;
GRANT INSERT, UPDATE, DELETE ON api_keys  TO authenticated;

-- Service role needs full access to bypass RLS for server-side operations
GRANT ALL ON api_keys    TO service_role;
GRANT ALL ON agents      TO service_role;
GRANT ALL ON jobs        TO service_role;
GRANT ALL ON trust_edges TO service_role;
GRANT ALL ON profiles    TO service_role;
