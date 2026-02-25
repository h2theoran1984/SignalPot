import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/agents/[slug] — Single agent detail with trust graph neighbors
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: agent, error } = await supabase
    .from("agents")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error || !agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Fetch trust graph neighbors
  const [{ data: incomingEdges }, { data: outgoingEdges }] = await Promise.all([
    supabase
      .from("trust_edges")
      .select("*, source_agent:agents!trust_edges_source_agent_id_fkey(id, name, slug)")
      .eq("target_agent_id", agent.id),
    supabase
      .from("trust_edges")
      .select("*, target_agent:agents!trust_edges_target_agent_id_fkey(id, name, slug)")
      .eq("source_agent_id", agent.id),
  ]);

  return NextResponse.json({
    agent,
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
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  // Remove fields that shouldn't be updated directly
  const { id: _id, owner_id: _oid, created_at: _ca, ...updates } = body;

  const { data, error } = await supabase
    .from("agents")
    .update(updates)
    .eq("slug", slug)
    .eq("owner_id", user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { error: "Agent not found or you are not the owner" },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
}
