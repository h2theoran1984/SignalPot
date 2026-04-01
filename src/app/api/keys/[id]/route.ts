import { NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { hasOrgRole } from "@/lib/rbac";
import { logAuditEvent, getClientIp } from "@/lib/audit";

// DELETE /api/keys/[id] — Revoke an API key (owner or org admin+)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(auth, "agents:write")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Fetch key to check ownership
  const { data: apiKey } = await auth.supabase
    .from("api_keys")
    .select("id, profile_id, org_id, name")
    .eq("id", id)
    .single();

  if (!apiKey) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  // Permission check: personal key → must be owner; org key → admin+
  if (apiKey.org_id) {
    if (auth.orgId !== apiKey.org_id || !hasOrgRole(auth, "admin")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    if (apiKey.profile_id !== auth.profileId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { error } = await auth.supabase
    .from("api_keys")
    .update({ revoked: true })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to revoke key" }, { status: 500 });
  }

  logAuditEvent({
    orgId: apiKey.org_id ?? null,
    actorId: auth.profileId,
    action: "api_key.revoked",
    targetType: "api_key",
    targetId: id,
    metadata: { name: apiKey.name },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ ok: true });
}
