import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { updateAgentSchema, stripSensitiveAgentFields } from "@/lib/validations";
import { canManageAgent, canDeleteAgent } from "@/lib/rbac";
import { logAuditEvent, getClientIp } from "@/lib/audit";

// GET /api/agents/[slug] — Single agent detail with trust graph neighbors
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: agent, error } = await supabase
    .from("agents")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error || !agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Strip auth_config for non-owners
  const safeAgent = stripSensitiveAgentFields(agent, user?.id);

  // Fetch trust graph neighbors with limits
  const [{ data: incomingEdges }, { data: outgoingEdges }] = await Promise.all([
    supabase
      .from("trust_edges")
      .select(
        "*, source_agent:agents!trust_edges_source_agent_id_fkey(id, name, slug)"
      )
      .eq("target_agent_id", agent.id)
      .order("trust_score", { ascending: false })
      .limit(50),
    supabase
      .from("trust_edges")
      .select(
        "*, target_agent:agents!trust_edges_target_agent_id_fkey(id, name, slug)"
      )
      .eq("source_agent_id", agent.id)
      .order("trust_score", { ascending: false })
      .limit(50),
  ]);

  return NextResponse.json({
    agent: safeAgent,
    trust_graph: {
      incoming: incomingEdges ?? [],
      outgoing: outgoingEdges ?? [],
    },
  });
}

// PATCH /api/agents/[slug] — Update agent (owner only)
export async function PATCH(
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

  const result = updateAgentSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: result.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const updates = result.data;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Fetch agent first to check permissions via RBAC
  const { data: agent } = await auth.supabase
    .from("agents")
    .select("id, owner_id, org_id")
    .eq("slug", slug)
    .single();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (!canManageAgent(auth, agent)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await auth.supabase
    .from("agents")
    .update(updates)
    .eq("slug", slug)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "An agent with this slug already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Failed to update agent" },
      { status: 500 }
    );
  }

  logAuditEvent({
    orgId: agent.org_id ?? null,
    actorId: auth.profileId,
    action: "agent.updated",
    targetType: "agent",
    targetId: agent.id,
    metadata: { slug, fields: Object.keys(updates) },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json(data);
}

// DELETE /api/agents/[slug] — Delete agent (owner or org admin+)
export async function DELETE(
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

  const { data: agent } = await auth.supabase
    .from("agents")
    .select("id, owner_id, org_id")
    .eq("slug", slug)
    .single();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (!canDeleteAgent(auth, agent)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await auth.supabase
    .from("agents")
    .delete()
    .eq("id", agent.id);

  if (error) {
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }

  logAuditEvent({
    orgId: agent.org_id ?? null,
    actorId: auth.profileId,
    action: "agent.deleted",
    targetType: "agent",
    targetId: agent.id,
    metadata: { slug },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ ok: true });
}
