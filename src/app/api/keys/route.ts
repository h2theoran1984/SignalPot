import { NextResponse } from "next/server";
import { generateApiKey } from "@/lib/api-keys";
import { createApiKeySchema } from "@/lib/validations";
import { getRpmForPlan, type Plan } from "@/lib/plans";
import { getAuthContext, checkPublicRateLimit, hasScope } from "@/lib/auth";
import { canCreateOrgKey } from "@/lib/rbac";
import { logAuditEvent, getClientIp } from "@/lib/audit";

// GET /api/keys — List current user's API keys (supports org context)
export async function GET(request: Request) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(auth, "agents:read")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let query = auth.supabase
    .from("api_keys")
    .select("id, name, key_prefix, scopes, rate_limit_rpm, last_used_at, expires_at, revoked, org_id, created_at")
    .order("created_at", { ascending: false });

  if (auth.orgId) {
    // Org context: show org keys
    query = query.eq("org_id", auth.orgId);
  } else {
    // Personal context: show personal keys only
    query = query.eq("profile_id", auth.profileId).is("org_id", null);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch API keys" },
      { status: 500 }
    );
  }

  return NextResponse.json({ keys: data ?? [] });
}

// POST /api/keys — Generate a new API key (supports org context)
export async function POST(request: Request) {
  const rateLimited = await checkPublicRateLimit(request);
  if (rateLimited) return rateLimited;

  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(auth, "agents:write")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Org key creation requires developer+ role
  if (auth.orgId && !canCreateOrgKey(auth)) {
    return NextResponse.json(
      { error: "Requires developer+ role to create org API keys" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const result = createApiKeySchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // Limit to 10 keys per user (personal) or per org
  let countQuery = auth.supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("revoked", false);

  if (auth.orgId) {
    countQuery = countQuery.eq("org_id", auth.orgId);
  } else {
    countQuery = countQuery.eq("profile_id", auth.profileId).is("org_id", null);
  }

  const { count } = await countQuery;

  if (count !== null && count >= 10) {
    return NextResponse.json(
      { error: "API key limit reached (max 10 active keys)" },
      { status: 429 }
    );
  }

  // Determine RPM from the user's plan
  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("plan")
    .eq("id", auth.profileId)
    .single();

  const plan = (profile?.plan ?? "free") as Plan;
  const rateLimit = getRpmForPlan(plan);

  const { key, hash, prefix } = generateApiKey();

  const { data, error } = await auth.supabase
    .from("api_keys")
    .insert({
      profile_id: auth.profileId,
      org_id: auth.orgId ?? null,
      name: result.data.name,
      key_hash: hash,
      key_prefix: prefix,
      scopes: result.data.scopes,
      rate_limit_rpm: rateLimit,
    })
    .select("id, name, key_prefix, scopes, rate_limit_rpm, org_id, created_at")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to create API key" },
      { status: 500 }
    );
  }

  logAuditEvent({
    orgId: auth.orgId ?? null,
    actorId: auth.profileId,
    action: "api_key.created",
    targetType: "api_key",
    targetId: data.id,
    metadata: { name: result.data.name },
    ipAddress: getClientIp(request),
  });

  // Return the full key ONCE — it cannot be retrieved again
  return NextResponse.json(
    { ...data, key },
    { status: 201 }
  );
}
