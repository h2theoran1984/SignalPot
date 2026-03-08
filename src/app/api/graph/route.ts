import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/graph — Full trust graph (all active agents + all trust edges)
export async function GET() {
  const supabase = await createClient();

  const [{ data: agents, error: agentsError }, { data: edges, error: edgesError }] =
    await Promise.all([
      supabase
        .from("agents")
        .select("id, name, slug, status, tags, rate_amount")
        .eq("status", "active")
        .order("name"),
      supabase
        .from("trust_edges")
        .select(
          "source_agent_id, target_agent_id, trust_score, total_jobs, successful_jobs, total_spent, avg_latency_ms"
        )
        .order("trust_score", { ascending: false })
        .limit(500),
    ]);

  if (agentsError || edgesError) {
    return NextResponse.json(
      { error: "Failed to fetch graph data" },
      { status: 500 }
    );
  }

  const allEdges = edges ?? [];

  // Pre-compute total jobs per agent for node sizing
  const jobCounts: Record<string, number> = {};
  for (const edge of allEdges) {
    jobCounts[edge.source_agent_id] =
      (jobCounts[edge.source_agent_id] ?? 0) + edge.total_jobs;
    jobCounts[edge.target_agent_id] =
      (jobCounts[edge.target_agent_id] ?? 0) + edge.total_jobs;
  }

  const nodes = (agents ?? []).map((agent) => ({
    id: agent.id,
    name: agent.name,
    slug: agent.slug,
    tags: agent.tags ?? [],
    rate: agent.rate_amount > 0 ? `$${agent.rate_amount} / call` : "Free",
    totalJobs: jobCounts[agent.id] ?? 0,
  }));

  const links = allEdges.map((edge) => ({
    source: edge.source_agent_id,
    target: edge.target_agent_id,
    trustScore: edge.trust_score,
    totalJobs: edge.total_jobs,
    successfulJobs: edge.successful_jobs,
    totalSpent: edge.total_spent,
    avgLatencyMs: edge.avg_latency_ms,
  }));

  return NextResponse.json({ nodes, links });
}
