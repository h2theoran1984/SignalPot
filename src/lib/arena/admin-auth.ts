import { createHash, timingSafeEqual } from "crypto";
import { checkAdminAuthRateLimit } from "@/lib/rate-limit";

/**
 * Verify an internal admin request using a dedicated ARENA_ADMIN_SECRET.
 * This separates arena admin access from the Supabase service-role key,
 * so a leaked admin secret cannot be used to bypass RLS on the database.
 *
 * Set ARENA_ADMIN_SECRET in your environment. If not set, internal admin
 * auth is disabled (all service-role-style requests will be rejected).
 *
 * Includes rate limiting (10 attempts/min per IP) and logging.
 */
export async function verifyArenaAdminAuth(request: Request): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // Rate limit admin auth attempts
  const rl = await checkAdminAuthRateLimit(ip);
  if (!rl.success) {
    console.warn(`[arena-admin] Rate limited admin auth attempt from ${ip}`);
    return false;
  }

  const token = authHeader.slice(7);
  const secret = process.env.ARENA_ADMIN_SECRET;

  if (!secret) {
    console.warn("[arena-admin] ARENA_ADMIN_SECRET not set — internal admin auth disabled");
    return false;
  }

  // Constant-time comparison via hashing both sides to equal length
  const tokenHash = createHash("sha256").update(token).digest();
  const secretHash = createHash("sha256").update(secret).digest();

  const valid = timingSafeEqual(tokenHash, secretHash);

  if (valid) {
    console.log(`[arena-admin] Successful admin auth from ${ip}`);
  } else {
    console.warn(`[arena-admin] Failed admin auth attempt from ${ip}`);
  }

  return valid;
}
