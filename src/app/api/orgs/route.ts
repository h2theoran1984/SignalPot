import { NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOrgSchema } from "@/lib/validations";
import { logAuditEvent, getClientIp } from "@/lib/audit";

// GET /api/orgs — List orgs the current user belongs to
export async function GET(request: Request) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(auth, "agents:read")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_members")
    .select("role, org:organizations(id, name, slug, avatar_url, plan, created_at)")
    .eq("profile_id", auth.profileId)
    .order("joined_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch organizations" }, { status: 500 });
  }

  const orgs = (data ?? []).map((row) => {
    const org = row.org as unknown as { id: string; name: string; slug: string; avatar_url: string | null; plan: string; created_at: string } | null;
    return {
      id: org?.id,
      name: org?.name,
      slug: org?.slug,
      avatar_url: org?.avatar_url,
      plan: org?.plan,
      created_at: org?.created_at,
      role: row.role,
    };
  });

  return NextResponse.json({ orgs });
}

// POST /api/orgs — Create a new organization
export async function POST(request: Request) {
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

  const result = createOrgSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Create the org
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: result.data.name,
      slug: result.data.slug,
      created_by: auth.profileId,
    })
    .select()
    .single();

  if (orgError) {
    if (orgError.code === "23505") {
      return NextResponse.json(
        { error: "An organization with this slug already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to create organization" }, { status: 500 });
  }

  // Auto-add creator as owner
  await admin.from("org_members").insert({
    org_id: org.id,
    profile_id: auth.profileId,
    role: "owner",
    invited_by: auth.profileId,
  });

  logAuditEvent({
    orgId: org.id,
    actorId: auth.profileId,
    action: "org.created",
    targetType: "organization",
    targetId: org.id,
    metadata: { name: result.data.name, slug: result.data.slug },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json(org, { status: 201 });
}
