import { NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteMemberSchema } from "@/lib/validations";
import { logAuditEvent, getClientIp } from "@/lib/audit";

/** Resolve org by slug and verify caller is a member. */
async function resolveOrg(slug: string, profileId: string) {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();

  if (!org) return null;

  const { data: membership } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("profile_id", profileId)
    .single();

  if (!membership) return null;

  return { orgId: org.id, role: membership.role };
}

// GET /api/orgs/[slug]/members — List members
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(auth, "agents:read")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const orgCtx = await resolveOrg(slug, auth.profileId);
  if (!orgCtx) {
    return NextResponse.json({ error: "Organization not found or not a member" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_members")
    .select("profile_id, role, joined_at, profile:profiles(id, full_name, avatar_url, email)")
    .eq("org_id", orgCtx.orgId)
    .order("joined_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
  }

  const members = (data ?? []).map((row) => {
    const profile = row.profile as unknown as { id: string; full_name: string; avatar_url: string | null; email: string } | null;
    const canViewEmail = ["owner", "admin", "auditor"].includes(orgCtx.role);
    return {
      profile_id: row.profile_id,
      role: row.role,
      joined_at: row.joined_at,
      full_name: profile?.full_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
      email: canViewEmail ? (profile?.email ?? null) : null,
    };
  });

  return NextResponse.json({ members });
}

// POST /api/orgs/[slug]/members — Add member by email (admin+)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(auth, "agents:write")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = inviteMemberSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const orgCtx = await resolveOrg(slug, auth.profileId);
  if (!orgCtx) {
    return NextResponse.json({ error: "Organization not found or not a member" }, { status: 404 });
  }
  if (!["owner", "admin"].includes(orgCtx.role)) {
    return NextResponse.json({ error: "Requires admin+ role in this organization" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Find user by email — they must already have an account
  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, email")
    .eq("email", result.data.email)
    .single();

  if (!profile) {
    return NextResponse.json(
      { error: "No account found for this email. User must sign up first." },
      { status: 404 }
    );
  }

  // Check if already a member
  const { data: existing } = await admin
    .from("org_members")
    .select("profile_id")
    .eq("org_id", orgCtx.orgId)
    .eq("profile_id", profile.id)
    .single();

  if (existing) {
    return NextResponse.json({ error: "User is already a member" }, { status: 409 });
  }

  // Can't invite as owner
  if (result.data.role === "owner" as string) {
    return NextResponse.json({ error: "Cannot assign owner role via invite" }, { status: 400 });
  }

  const { error: insertError } = await admin.from("org_members").insert({
    org_id: orgCtx.orgId,
    profile_id: profile.id,
    role: result.data.role,
    invited_by: auth.profileId,
  });

  if (insertError) {
    return NextResponse.json({ error: "Failed to add member" }, { status: 500 });
  }

  logAuditEvent({
    orgId: orgCtx.orgId,
    actorId: auth.profileId,
    action: "member.added",
    targetType: "profile",
    targetId: profile.id,
    metadata: { email: result.data.email, role: result.data.role },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json(
    { profile_id: profile.id, role: result.data.role, name: profile.full_name },
    { status: 201 }
  );
}
