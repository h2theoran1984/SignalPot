import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyApiKey } from "@/lib/api-keys";
import { checkApiKeyRateLimit, checkIpRateLimit } from "@/lib/rate-limit";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OrgRole = "owner" | "admin" | "developer" | "viewer" | "auditor";

export interface AuthContext {
  profileId: string;
  authMethod: "session" | "api_key";
  scopes: string[];
  supabase: SupabaseClient;
  orgId: string | null;
  orgRole: OrgRole | null;
}

/**
 * Get auth context from either API key (Bearer token) or cookie session.
 * Returns null if unauthenticated.
 */
export async function getAuthContext(
  request: Request
): Promise<AuthContext | null> {
  const authHeader = request.headers.get("authorization");

  // Try API key auth first
  if (authHeader?.startsWith("Bearer sp_live_")) {
    const key = authHeader.slice(7); // Remove "Bearer "
    const verified = await verifyApiKey(key);
    if (!verified) return null;

    // Check rate limit for this API key
    const rateCheck = await checkApiKeyRateLimit(
      verified.keyPrefix,
      verified.rateLimitRpm
    );
    if (!rateCheck.success) return null; // Caller should check and return 429

    // Resolve org context: key's org_id takes precedence, then X-Org-Id header
    const orgContext = await resolveOrgContext(
      verified.profileId,
      verified.orgId || request.headers.get("x-org-id")
    );

    return {
      profileId: verified.profileId,
      authMethod: "api_key",
      scopes: verified.scopes,
      supabase: createAdminClient(),
      orgId: orgContext?.orgId ?? null,
      orgRole: orgContext?.orgRole ?? null,
    };
  }

  // Fall back to cookie session
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Resolve org context from X-Org-Id header
  const orgContext = await resolveOrgContext(
    user.id,
    request.headers.get("x-org-id")
  );

  return {
    profileId: user.id,
    authMethod: "session",
    scopes: ["agents:read", "agents:write", "jobs:read", "jobs:write", "trust:read"],
    supabase,
    orgId: orgContext?.orgId ?? null,
    orgRole: orgContext?.orgRole ?? null,
  };
}

/**
 * Resolve org context for a user. Returns null if no org requested
 * or if the user is not a member of the requested org.
 */
async function resolveOrgContext(
  profileId: string,
  orgIdHeader: string | null
): Promise<{ orgId: string; orgRole: OrgRole } | null> {
  if (!orgIdHeader) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_members")
    .select("org_id, role")
    .eq("profile_id", profileId)
    .eq("org_id", orgIdHeader)
    .single();

  if (error || !data) return null;

  return { orgId: data.org_id, orgRole: data.role as OrgRole };
}

/**
 * Check if auth context has a required scope.
 */
export function hasScope(auth: AuthContext, scope: string): boolean {
  return auth.scopes.includes(scope);
}

/**
 * Build a 429 rate limit response with Retry-After header.
 */
export function rateLimitResponse(reset: number): NextResponse {
  const retryAfter = Math.ceil((reset - Date.now()) / 1000);
  return NextResponse.json(
    { error: "Rate limit exceeded" },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(retryAfter, 1)) },
    }
  );
}

/**
 * Check IP-based rate limit for unauthenticated requests.
 * Returns a 429 response if exceeded, or null if OK.
 */
export async function checkPublicRateLimit(
  request: Request
): Promise<NextResponse | null> {
  // On Vercel, the platform appends the real client IP as the last entry in x-forwarded-for.
  // Using the first entry is spoofable; the last entry is trustworthy.
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",").pop()!.trim()
    : request.headers.get("x-real-ip") || "unknown";

  const result = await checkIpRateLimit(ip);
  if (!result.success) {
    return rateLimitResponse(result.reset);
  }
  return null;
}
