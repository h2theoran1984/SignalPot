import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateMemberRoleSchema } from "@/lib/validations";
import { canManageMembers } from "@/lib/rbac";
import { logAuditEvent, getClientIp } from "@/lib/audit";

// PATCH /api/orgs/[slug]/members/[memberId] — Change role (admin+)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; memberId: string }> }
) {
  const { slug, memberId } = await params;
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canManageMembers(auth)) {
    return NextResponse.json({ error: "Requires admin+ role" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = updateMemberRoleSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Resolve org
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();

  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // Can't change the owner's role
  const { data: target } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("profile_id", memberId)
    .single();

  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (target.role === "owner") {
    return NextResponse.json({ error: "Cannot change the owner's role" }, { status: 403 });
  }

  const { error } = await admin
    .from("org_members")
    .update({ role: result.data.role })
    .eq("org_id", org.id)
    .eq("profile_id", memberId);

  if (error) {
    return NextResponse.json({ error: "Failed to update role" }, { status: 500 });
  }

  logAuditEvent({
    orgId: org.id,
    actorId: auth.profileId,
    action: "member.role_changed",
    targetType: "profile",
    targetId: memberId,
    metadata: { from: target.role, to: result.data.role },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ ok: true, role: result.data.role });
}

// DELETE /api/orgs/[slug]/members/[memberId] — Remove member (admin+)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; memberId: string }> }
) {
  const { slug, memberId } = await params;
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canManageMembers(auth)) {
    return NextResponse.json({ error: "Requires admin+ role" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();

  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // Can't remove the owner
  const { data: target } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("profile_id", memberId)
    .single();

  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (target.role === "owner") {
    return NextResponse.json({ error: "Cannot remove the org owner" }, { status: 403 });
  }

  const { error } = await admin
    .from("org_members")
    .delete()
    .eq("org_id", org.id)
    .eq("profile_id", memberId);

  if (error) {
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }

  logAuditEvent({
    orgId: org.id,
    actorId: auth.profileId,
    action: "member.removed",
    targetType: "profile",
    targetId: memberId,
    metadata: { role: target.role },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ ok: true });
}
