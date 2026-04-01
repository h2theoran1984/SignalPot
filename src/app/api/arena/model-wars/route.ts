import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPublicRateLimit } from "@/lib/auth";

/**
 * GET /api/arena/model-wars — Model performance comparison data.
 *
 * Aggregates Arena match results grouped by model, showing win rates,
 * costs, latency, and head-to-head records. Public endpoint.
 */
export async function GET(request: Request) {
  const rateLimited = await checkPublicRateLimit(request);
  if (rateLimited) return rateLimited;

  const admin = createAdminClient();

  // Fetch all completed matches with agent info
  const { data: matches } = await admin
    .from("arena_matches")
    .select("agent_a_id, agent_b_id, winner, judgment_breakdown, duration_a_ms, duration_b_ms, api_cost_a, api_cost_b, cost_a, cost_b, completed_at")
    .eq("status", "completed")
    .order("completed_at", { ascending: false });

  if (!matches || matches.length === 0) {
    return NextResponse.json({ models: [], headToHead: [], lastUpdated: new Date().toISOString() });
  }

  // Fetch all agents involved
  const agentIds = new Set<string>();
  for (const m of matches) {
    agentIds.add(m.agent_a_id as string);
    agentIds.add(m.agent_b_id as string);
  }

  const { data: agents } = await admin
    .from("agents")
    .select("id, name, slug, model_id")
    .in("id", Array.from(agentIds));

  if (!agents) {
    return NextResponse.json({ models: [], headToHead: [], lastUpdated: new Date().toISOString() });
  }

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // Skip sparring partner
  const sparring = agents.find((a) => a.slug === "sparring-partner");
  const sparringId = sparring?.id;

  // ── Aggregate by model ──
  interface ModelStats {
    model_id: string;
    agents: Set<string>;
    matches: number;
    wins: number;
    losses: number;
    ties: number;
    totalApiCost: number;
    totalAgentCost: number;
    totalLatencyMs: number;
    totalScore: number;
    scoreCount: number;
  }

  const modelStats = new Map<string, ModelStats>();

  function getOrCreate(modelId: string): ModelStats {
    let stats = modelStats.get(modelId);
    if (!stats) {
      stats = {
        model_id: modelId,
        agents: new Set(),
        matches: 0, wins: 0, losses: 0, ties: 0,
        totalApiCost: 0, totalAgentCost: 0, totalLatencyMs: 0,
        totalScore: 0, scoreCount: 0,
      };
      modelStats.set(modelId, stats);
    }
    return stats;
  }

  // ── Head-to-head tracking ──
  interface H2HRecord {
    model_a: string;
    model_b: string;
    wins_a: number;
    wins_b: number;
    ties: number;
  }
  const h2hMap = new Map<string, H2HRecord>();

  for (const m of matches) {
    const agentA = agentMap.get(m.agent_a_id as string);
    const agentB = agentMap.get(m.agent_b_id as string);
    if (!agentA || !agentB) continue;

    // Skip sparring partner matches for model comparison
    if (agentA.id === sparringId || agentB.id === sparringId) continue;

    const modelA = (agentA.model_id as string) ?? "unknown";
    const modelB = (agentB.model_id as string) ?? "unknown";
    const breakdown = m.judgment_breakdown as Record<string, unknown> | null;

    // Agent A stats
    const statsA = getOrCreate(modelA);
    statsA.agents.add(agentA.slug as string);
    statsA.matches++;
    statsA.totalApiCost += Number(m.api_cost_a) || 0;
    statsA.totalAgentCost += Number(m.cost_a) || 0;
    statsA.totalLatencyMs += (m.duration_a_ms as number) ?? 0;
    if (breakdown) {
      const score = breakdown.total_a as number;
      if (score != null) { statsA.totalScore += score; statsA.scoreCount++; }
    }

    // Agent B stats
    const statsB = getOrCreate(modelB);
    statsB.agents.add(agentB.slug as string);
    statsB.matches++;
    statsB.totalApiCost += Number(m.api_cost_b) || 0;
    statsB.totalAgentCost += Number(m.cost_b) || 0;
    statsB.totalLatencyMs += (m.duration_b_ms as number) ?? 0;
    if (breakdown) {
      const score = breakdown.total_b as number;
      if (score != null) { statsB.totalScore += score; statsB.scoreCount++; }
    }

    // Win/loss/tie
    if (m.winner === "a") { statsA.wins++; statsB.losses++; }
    else if (m.winner === "b") { statsB.wins++; statsA.losses++; }
    else { statsA.ties++; statsB.ties++; }

    // Head-to-head (only cross-model matchups)
    if (modelA !== modelB) {
      const [first, second] = [modelA, modelB].sort();
      const h2hKey = `${first}::${second}`;
      let h2h = h2hMap.get(h2hKey);
      if (!h2h) {
        h2h = { model_a: first, model_b: second, wins_a: 0, wins_b: 0, ties: 0 };
        h2hMap.set(h2hKey, h2h);
      }
      if (m.winner === "tie") {
        h2h.ties++;
      } else {
        const winnerModel = m.winner === "a" ? modelA : modelB;
        if (winnerModel === first) h2h.wins_a++;
        else h2h.wins_b++;
      }
    }
  }

  // ── Format output ──
  const MODEL_LABELS: Record<string, string> = {
    "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
    "claude-sonnet-4-5-20250514": "Claude Sonnet 4.5",
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "claude-opus-4-6-20250619": "Claude Opus 4.6",
    "gemini-2.0-flash": "Gemini 2.0 Flash",
    "gemini-2.5-flash-preview-05-20": "Gemini 2.5 Flash",
    "gemini-3-flash-preview": "Gemini 3.0 Flash",
  };

  const MODEL_COST_PER_M: Record<string, { input: number; output: number }> = {
    "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
    "claude-sonnet-4-5-20250514": { input: 3.0, output: 15.0 },
    "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
    "claude-opus-4-6-20250619": { input: 15.0, output: 75.0 },
    "gemini-2.0-flash": { input: 0.10, output: 0.40 },
    "gemini-2.5-flash-preview-05-20": { input: 0.15, output: 0.60 },
    "gemini-3-flash-preview": { input: 0.15, output: 0.60 },
  };

  const models = Array.from(modelStats.values())
    .filter((s) => s.matches >= 2)
    .map((s) => {
      const winRate = s.matches > 0 ? s.wins / s.matches : 0;
      const avgApiCost = s.matches > 0 ? s.totalApiCost / s.matches : 0;
      const avgLatency = s.matches > 0 ? Math.round(s.totalLatencyMs / s.matches) : 0;
      const avgScore = s.scoreCount > 0 ? s.totalScore / s.scoreCount : 0;
      const pricing = MODEL_COST_PER_M[s.model_id];
      const costPerWin = s.wins > 0 ? s.totalApiCost / s.wins : null;

      return {
        model_id: s.model_id,
        label: MODEL_LABELS[s.model_id] ?? s.model_id,
        provider: s.model_id.startsWith("claude") ? "Anthropic" : s.model_id.startsWith("gemini") ? "Google" : "Unknown",
        agents: Array.from(s.agents),
        matches: s.matches,
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        win_rate: Math.round(winRate * 1000) / 1000,
        avg_score: Math.round(avgScore * 1000) / 1000,
        avg_api_cost: Math.round(avgApiCost * 1000000) / 1000000,
        avg_latency_ms: avgLatency,
        cost_per_win: costPerWin ? Math.round(costPerWin * 1000000) / 1000000 : null,
        pricing_per_m_tokens: pricing ?? null,
      };
    })
    .sort((a, b) => b.win_rate - a.win_rate || b.avg_score - a.avg_score);

  const headToHead = Array.from(h2hMap.values()).map((h) => ({
    ...h,
    label_a: MODEL_LABELS[h.model_a] ?? h.model_a,
    label_b: MODEL_LABELS[h.model_b] ?? h.model_b,
    total: h.wins_a + h.wins_b + h.ties,
  }));

  return NextResponse.json(
    {
      models,
      headToHead,
      totalMatches: matches.length,
      lastUpdated: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    }
  );
}
