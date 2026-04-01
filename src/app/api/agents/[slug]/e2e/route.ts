import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { enableE2E, disableE2E, getAgentPublicKey } from "@/lib/e2e";
import { logAuditEvent, getClientIp } from "@/lib/audit";

/**
 * GET /api/agents/[slug]/e2e — Get E2E encryption status and public key.
 * Public endpoint.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const admin = createAdminClient();

  const { data: agent } = await admin
    .from("agents")
    .select("id, e2e_enabled")
    .eq("slug", slug)
    .eq("status", "active")
    .single();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (!agent.e2e_enabled) {
    return NextResponse.json({ enabled: false, public_key: null });
  }

  const key = await getAgentPublicKey(agent.id as string);

  return NextResponse.json({
    enabled: true,
    public_key: key
      ? {
          kid: key.kid,
          version: key.version,
          jwk: key.jwk,
          activated_at: key.activatedAt,
        }
      : null,
  });
}

/**
 * POST /api/agents/[slug]/e2e — Enable E2E encryption (generates keypair).
 * Requires agent owner auth.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const admin = createAdminClient();

  const { data: agent } = await admin
    .from("agents")
    .select("id, slug, owner_id, e2e_enabled")
    .eq("slug", slug)
    .single();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (agent.owner_id !== auth.profileId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await enableE2E(
      agent.id as string,
      agent.slug as string,
      auth.profileId
    );

    logAuditEvent({
      orgId: auth.orgId,
      actorId: auth.profileId,
      action: "e2e_key.enabled",
      targetType: "agent",
      targetId: agent.id as string,
      metadata: { kid: result.kid, version: result.version },
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({
      enabled: true,
      kid: result.kid,
      version: result.version,
      public_key_jwk: result.publicKeyJwk,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enable E2E";
    console.error("[e2e] Enable failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/agents/[slug]/e2e — Disable E2E encryption (revokes keys).
 * Requires agent owner auth.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const admin = createAdminClient();

  const { data: agent } = await admin
    .from("agents")
    .select("id, owner_id")
    .eq("slug", slug)
    .single();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (agent.owner_id !== auth.profileId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await disableE2E(agent.id as string);

  logAuditEvent({
    orgId: auth.orgId,
    actorId: auth.profileId,
    action: "e2e_key.disabled",
    targetType: "agent",
    targetId: agent.id as string,
    metadata: {},
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ enabled: false });
}
