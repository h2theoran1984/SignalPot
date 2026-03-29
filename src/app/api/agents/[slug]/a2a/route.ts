// GET /api/agents/[slug]/a2a — A2A Agent Card for a specific agent.
// Includes SignalPot extensions with verified performance data from
// telemetry, trust graph, and arena ratings.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildAgentCard } from "@/lib/a2a/handler";
import type { SignalPotExtensions } from "@/lib/a2a/types";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://signalpot.dev";

  const supabase = await createClient();
  const { data: agent, error } = await supabase
    .from("agents")
    .select("*")
    .eq("slug", slug)
    .eq("status", "active")
    .single();

  if (error || !agent) {
    return NextResponse.json(
      { error: "Agent not found" },
      { status: 404, headers: CORS }
    );
  }

  const card = buildAgentCard(agent, baseUrl);

  // Enrich with SignalPot verified performance extensions
  const admin = createAdminClient();
  const agentId = agent.id as string;

  const [trustResult, eloResult, telemetryResult, arenaResult] = await Promise.all([
    // Best trust score (self-referential or highest incoming)
    admin
      .from("trust_edges")
      .select("trust_score, last_job_at")
      .eq("target_agent_id", agentId)
      .order("trust_score", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Best ELO rating
    admin
      .from("arena_ratings")
      .select("elo, wins, losses, ties")
      .eq("agent_id", agentId)
      .order("elo", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Telemetry aggregates
    admin
      .from("agent_telemetry")
      .select("success")
      .eq("agent_id", agentId)
      .in("event", ["call_completed", "call_failed"]),
    // Arena match record
    admin
      .from("arena_matches")
      .select("winner, agent_a_id")
      .eq("status", "completed")
      .or(`agent_a_id.eq.${agentId},agent_b_id.eq.${agentId}`),
  ]);

  // Compute telemetry stats
  const telemetryRows = telemetryResult.data ?? [];
  const verifiedCalls = telemetryRows.length;
  const successfulCalls = telemetryRows.filter((r) => r.success).length;
  const successRate = verifiedCalls > 0 ? successfulCalls / verifiedCalls : 0;

  // Compute arena record
  let arenaRecord: SignalPotExtensions["arenaRecord"] = null;
  if (arenaResult.data && arenaResult.data.length > 0) {
    let wins = 0, losses = 0, ties = 0;
    for (const m of arenaResult.data) {
      const side = m.agent_a_id === agentId ? "a" : "b";
      if (m.winner === "tie") ties++;
      else if (m.winner === side) wins++;
      else losses++;
    }
    arenaRecord = { wins, losses, ties };
  }

  const trustEdge = trustResult.data;
  const eloRow = eloResult.data;

  const extensions: SignalPotExtensions = {
    trustScore: Math.round(((trustEdge?.trust_score as number) ?? 0) * 10000) / 10000,
    verifiedCalls,
    successRate: Math.round(successRate * 10000) / 10000,
    avgLatencyMs: (agent.avg_latency_ms as number) ?? null,
    eloRating: (eloRow?.elo as number) ?? null,
    arenaRecord,
    costPerCall: Number(agent.rate_amount) || 0,
    uptimePct: (agent.uptime_pct as number) ?? 100,
    lastActiveAt: (trustEdge?.last_job_at as string) ?? null,
    profileUrl: `${baseUrl}/agents/${agent.slug}`,
    extractUrl: `${baseUrl}/arena/training/${agent.slug}/extract`,
  };

  card.extensions = { signalpot: extensions };

  return NextResponse.json(card, { headers: CORS });
}
