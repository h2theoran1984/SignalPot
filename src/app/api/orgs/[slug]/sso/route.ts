import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ssoConfigSchema } from "@/lib/validations";
import { logAuditEvent, getClientIp } from "@/lib/audit";

const SSO_DEFAULTS = {
  enabled: false,
  provider: null,
  client_id: null,
  issuer_url: null,
  allowed_domains: [],
  auto_provision: false,
  default_role: "developer",
};

// GET /api/orgs/[slug]/sso — Get SSO configuration (owner only)
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

  // Look up org
  const { data: org } = await admin
    .from("organizations")
    .select("id, settings")
    .eq("slug", slug)
    .single();

  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // Verify caller is owner
  const { data: membership } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("profile_id", auth.profileId)
    .single();

  if (!membership || membership.role !== "owner") {
    return NextResponse.json({ error: "Only the org owner can view SSO settings" }, { status: 403 });
  }

  const ssoConfig = (org.settings as Record<string, unknown>)?.sso ?? SSO_DEFAULTS;

  return NextResponse.json(ssoConfig);
}

// PATCH /api/orgs/[slug]/sso — Update SSO configuration (owner only)
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

  const result = ssoConfigSchema.safeParse(body);
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
    .select("id, settings")
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
    return NextResponse.json({ error: "Only the org owner can update SSO settings" }, { status: 403 });
  }

  // Merge SSO config into existing settings
  const existingSettings = (org.settings as Record<string, unknown>) ?? {};
  const updatedSettings = {
    ...existingSettings,
    sso: result.data,
  };

  const { data: updated, error } = await admin
    .from("organizations")
    .update({ settings: updatedSettings })
    .eq("id", org.id)
    .select("settings")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to update SSO configuration" }, { status: 500 });
  }

  logAuditEvent({
    orgId: org.id,
    actorId: auth.profileId,
    action: "org.sso.updated",
    targetType: "organization",
    targetId: org.id,
    metadata: {
      provider: result.data.provider,
      enabled: result.data.enabled,
      allowed_domains: result.data.allowed_domains,
    },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json((updated.settings as Record<string, unknown>).sso);
}
