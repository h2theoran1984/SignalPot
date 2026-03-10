import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateOrgSchema } from "@/lib/validations";
import { hasOrgRole } from "@/lib/rbac";
import { logAuditEvent, getClientIp } from "@/lib/audit";

// GET /api/orgs/[slug] — Org details (members can view)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: org, error } = await admin
    .from("organizations")
    .select("id, name, slug, avatar_url, plan, created_at")
    .eq("slug", slug)
    .single();

  if (error || !org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // Verify membership
  const { data: membership } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("profile_id", auth.profileId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
  }

  // Get member count
  const { count: memberCount } = await admin
    .from("org_members")
    .select("profile_id", { count: "exact", head: true })
    .eq("org_id", org.id);

  // Get agent count
  const { count: agentCount } = await admin
    .from("agents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", org.id);

  return NextResponse.json({
    ...org,
    role: membership.role,
    member_count: memberCount ?? 0,
    agent_count: agentCount ?? 0,
  });
}

// PATCH /api/orgs/[slug] — Update org (owner only)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = updateOrgSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Look up org and verify caller is owner
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();

  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const { data: membership } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("profile_id", auth.profileId)
    .single();

  if (!membership || membership.role !== "owner") {
    return NextResponse.json({ error: "Only the org owner can update settings" }, { status: 403 });
  }

  const { data: updated, error } = await admin
    .from("organizations")
    .update(result.data)
    .eq("id", org.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to update organization" }, { status: 500 });
  }

  logAuditEvent({
    orgId: org.id,
    actorId: auth.profileId,
    action: "org.updated",
    targetType: "organization",
    targetId: org.id,
    metadata: { fields: Object.keys(result.data) },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json(updated);
}
