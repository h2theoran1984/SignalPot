-- Efficient user lookup by email for SSO callback.
-- Replaces listUsers() which fetches ALL users and filters client-side.

CREATE OR REPLACE FUNCTION lookup_auth_user_by_email(p_email TEXT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
STABLE
AS $$
  SELECT id FROM auth.users
  WHERE lower(email) = lower(p_email)
  LIMIT 1;
$$;
