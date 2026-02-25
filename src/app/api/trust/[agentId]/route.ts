import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/trust/[agentId] — Trust graph for an agent
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  // Validate UUID format
  if (!UUID_REGEX.test(agentId)) {
    return NextResponse.json(
      { error: "Invalid agent ID format" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Get agent info
  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id, name, slug")
    .eq("id", agentId)
    .single();

  if (agentError || !agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Get trust edges with pagination limits
  const [{ data: incoming }, { data: outgoing }] = await Promise.all([
    supabase
      .from("trust_edges")
      .select(
        "*, source_agent:agents!trust_edges_source_agent_id_fkey(id, name, slug, status)"
      )
      .eq("target_agent_id", agentId)
      .order("trust_score", { ascending: false })
      .limit(100),
    supabase
      .from("trust_edges")
      .select(
        "*, target_agent:agents!trust_edges_target_agent_id_fkey(id, name, slug, status)"
      )
      .eq("source_agent_id", agentId)
      .order("trust_score", { ascending: false })
      .limit(100),
  ]);

  const incomingEdges = incoming ?? [];
  const outgoingEdges = outgoing ?? [];

  const totalIncomingTrust = incomingEdges.reduce(
    (sum, e) => sum + e.trust_score,
    0
  );
  const avgIncomingTrust =
    incomingEdges.length > 0 ? totalIncomingTrust / incomingEdges.length : 0;

  return NextResponse.json({
    agent,
    summary: {
      total_trusters: incomingEdges.length,
      total_trusted: outgoingEdges.length,
      avg_incoming_trust_score: avgIncomingTrust,
      total_jobs_as_provider: incomingEdges.reduce(
        (sum, e) => sum + e.total_jobs,
        0
      ),
      total_jobs_as_requester: outgoingEdges.reduce(
        (sum, e) => sum + e.total_jobs,
        0
      ),
    },
    incoming: incomingEdges,
    outgoing: outgoingEdges,
  });
}
