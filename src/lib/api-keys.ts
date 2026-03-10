import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const KEY_PREFIX = "sp_live_";

export function generateApiKey(): {
  key: string;
  hash: string;
  prefix: string;
} {
  const random = randomBytes(24).toString("hex");
  const key = `${KEY_PREFIX}${random}`;
  const hash = hashApiKey(key);
  const prefix = key.slice(0, KEY_PREFIX.length + 8);
  return { key, hash, prefix };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function verifyApiKey(key: string): Promise<{
  profileId: string;
  scopes: string[];
  rateLimitRpm: number;
  keyPrefix: string;
  orgId: string | null;
} | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;

  const hash = hashApiKey(key);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("api_keys")
    .select("profile_id, scopes, rate_limit_rpm, key_prefix, revoked, expires_at, org_id")
    .eq("key_hash", hash)
    .single();

  if (error || !data) return null;
  if (data.revoked) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Update last_used_at (fire-and-forget with error handling)
  Promise.resolve(
    supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("key_hash", hash)
  ).catch((err) => console.error("Failed to update last_used_at:", err));

  return {
    profileId: data.profile_id,
    scopes: data.scopes,
    rateLimitRpm: data.rate_limit_rpm,
    keyPrefix: data.key_prefix,
    orgId: data.org_id ?? null,
  };
}
