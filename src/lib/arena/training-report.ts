// Training Analysis Engine — generates coaching reports after sparring partner sessions.
// Aggregates judgment_breakdown scores across recent training matches and uses
// Claude Haiku to produce actionable coaching advice.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JudgmentBreakdown, CriterionScore } from "./types";

// ============================================================
// Output Types
// ============================================================

export interface TrainingReport {
  agentId: string;
  agentName: string;
  matchCount: number;
  period: { from: string; to: string };

  overall: {
    winRate: number; // 0-1
    avgScore: number; // average total weighted score
    eloStart: number;
    eloCurrent: number;
    eloChange: number;
  };

  criteria: Array<{
    name: string;
    weight: number;
    avgScore: number; // 0-1 (raw criterion score)
    trend: "improving" | "declining" | "stable";
    best: number;
    worst: number;
    matchScores: number[]; // score per match for sparkline (oldest → newest)
  }>;

  strengths: string[]; // top criteria names
  weaknesses: string[]; // bottom criteria names

  recommendation: string; // LLM-generated coaching advice
}

// ============================================================
// Helpers
// ============================================================

const SPARRING_SLUG = "sparring-partner";
const DEFAULT_MATCH_COUNT = 10;
const DEFAULT_ELO = 1200;

/** Determine the trend direction from a series of scores using simple linear regression slope. */
function computeTrend(scores: number[]): "improving" | "declining" | "stable" {
  if (scores.length < 3) return "stable";

  const n = scores.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += scores[i];
    sumXY += i * scores[i];
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // Threshold: a slope of ±0.02 per match is considered meaningful
  if (slope > 0.02) return "improving";
  if (slope < -0.02) return "declining";
  return "stable";
}

/**
 * Extract the criterion scores for the target agent from a match's judgment_breakdown.
 * The agent can be on side A or side B — we figure out which and return the right scores.
 */
function extractAgentScores(
  breakdown: JudgmentBreakdown,
  agentSide: "a" | "b"
): { criteriaScores: CriterionScore[]; totalScore: number } {
  const criteriaScores =
    agentSide === "a" ? breakdown.criteria_scores_a : breakdown.criteria_scores_b;
  const totalScore =
    agentSide === "a" ? breakdown.total_a : breakdown.total_b;

  return { criteriaScores, totalScore };
}

// ============================================================
// Core Function
// ============================================================

/**
 * Generate a training analysis report for an agent based on recent sparring matches.
 *
 * @param admin - Supabase admin client (service role, bypasses RLS)
 * @param agentId - The agent's UUID
 * @param options - { matchCount: number of recent matches to analyze }
 */
export async function generateTrainingReport(
  admin: SupabaseClient,
  agentId: string,
  options: { matchCount?: number } = {}
): Promise<TrainingReport> {
  const matchCount = options.matchCount ?? DEFAULT_MATCH_COUNT;

  // ── 1. Fetch the agent ────────────────────────────────────────────
  const { data: agent, error: agentErr } = await admin
    .from("agents")
    .select("id, name, slug, capability_schema")
    .eq("id", agentId)
    .single();

  if (agentErr || !agent) {
    throw new Error("Agent not found");
  }

  // ── 2. Find the sparring partner agent ID ─────────────────────────
  const { data: sparring } = await admin
    .from("agents")
    .select("id")
    .eq("slug", SPARRING_SLUG)
    .single();

  const sparringId = sparring?.id as string | undefined;
  if (!sparringId) {
    throw new Error("Sparring partner agent not found");
  }

  // ── 3. Query recent completed matches against the sparring partner ─
  //    The agent could be on side A or side B. We need both cases.
  const { data: matches, error: matchErr } = await admin
    .from("arena_matches")
    .select(
      "id, agent_a_id, agent_b_id, capability, winner, judgment_breakdown, completed_at, created_at"
    )
    .eq("status", "completed")
    .or(
      `and(agent_a_id.eq.${agentId},agent_b_id.eq.${sparringId}),and(agent_a_id.eq.${sparringId},agent_b_id.eq.${agentId})`
    )
    .order("completed_at", { ascending: false })
    .limit(matchCount);

  if (matchErr) {
    throw new Error(`Failed to query matches: ${matchErr.message}`);
  }

  if (!matches || matches.length === 0) {
    throw new Error("No completed training matches found for this agent");
  }

  // Reverse to oldest-first for trend analysis
  const sortedMatches = [...matches].reverse();

  // ── 4. Fetch ELO rating ───────────────────────────────────────────
  // Use the first match's capability for ELO lookup (training is usually single-capability)
  const primaryCapability = sortedMatches[0].capability as string;

  const { data: ratingRow } = await admin
    .from("arena_ratings")
    .select("elo")
    .eq("agent_id", agentId)
    .eq("capability", primaryCapability)
    .single();

  const currentElo = (ratingRow?.elo as number) ?? DEFAULT_ELO;

  // ── 5. Aggregate per-criterion scores ─────────────────────────────
  // Collect criterion names and their scores across all matches
  const criterionMap = new Map<
    string,
    { weight: number; scores: number[] }
  >();
  const totalScores: number[] = [];
  let wins = 0;
  let ties = 0;

  for (const match of sortedMatches) {
    const breakdown = match.judgment_breakdown as JudgmentBreakdown | null;
    if (!breakdown) continue;

    // Determine which side this agent is on
    const agentSide: "a" | "b" = match.agent_a_id === agentId ? "a" : "b";
    const { criteriaScores, totalScore } = extractAgentScores(breakdown, agentSide);

    totalScores.push(totalScore);

    // Count wins from the agent's perspective
    const winner = match.winner as string | null;
    if (winner === agentSide) {
      wins++;
    } else if (winner === "tie") {
      ties++;
    }

    for (const cs of criteriaScores) {
      const existing = criterionMap.get(cs.name);
      if (existing) {
        existing.scores.push(cs.score);
      } else {
        criterionMap.set(cs.name, { weight: cs.weight, scores: [cs.score] });
      }
    }
  }

  const matchesWithBreakdown = totalScores.length;

  // ── 6. Build criteria analysis ────────────────────────────────────
  const criteriaAnalysis: TrainingReport["criteria"] = [];

  for (const [name, data] of criterionMap) {
    const scores = data.scores;
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    const best = Math.max(...scores);
    const worst = Math.min(...scores);
    const trend = computeTrend(scores);

    criteriaAnalysis.push({
      name,
      weight: data.weight,
      avgScore: Math.round(avg * 1000) / 1000,
      trend,
      best: Math.round(best * 1000) / 1000,
      worst: Math.round(worst * 1000) / 1000,
      matchScores: scores.map((s) => Math.round(s * 1000) / 1000),
    });
  }

  // Sort by avgScore for strengths/weaknesses identification
  const sorted = [...criteriaAnalysis].sort((a, b) => b.avgScore - a.avgScore);
  const strengths = sorted.slice(0, 2).map((c) => c.name);
  const weaknesses = sorted.slice(-2).map((c) => c.name);

  // ── 7. Compute overall stats ──────────────────────────────────────
  const winRate = matchesWithBreakdown > 0 ? wins / matchesWithBreakdown : 0;
  const avgScore =
    totalScores.length > 0
      ? totalScores.reduce((s, v) => s + v, 0) / totalScores.length
      : 0;

  // Estimate ELO at start of the period — rough approximation using
  // K=32 and match count (each win/loss shifts ~16 ELO on average against 1200).
  const netWins = wins - (matchesWithBreakdown - wins - ties);
  const estimatedEloStart = Math.round(currentElo - netWins * 16);

  const period = {
    from: sortedMatches[0].completed_at as string ?? sortedMatches[0].created_at as string,
    to: sortedMatches[sortedMatches.length - 1].completed_at as string ??
      sortedMatches[sortedMatches.length - 1].created_at as string,
  };

  // ── 8. Generate LLM coaching recommendation ───────────────────────
  const recommendation = await generateCoachingAdvice({
    agentName: agent.name as string,
    capability: primaryCapability,
    winRate,
    avgScore,
    strengths,
    weaknesses,
    criteria: criteriaAnalysis,
  });

  return {
    agentId,
    agentName: agent.name as string,
    matchCount: matchesWithBreakdown,
    period,
    overall: {
      winRate: Math.round(winRate * 1000) / 1000,
      avgScore: Math.round(avgScore * 1000) / 1000,
      eloStart: estimatedEloStart,
      eloCurrent: currentElo,
      eloChange: currentElo - estimatedEloStart,
    },
    criteria: criteriaAnalysis,
    strengths,
    weaknesses,
    recommendation,
  };
}

// ============================================================
// LLM Coaching Advice
// ============================================================

interface CoachingContext {
  agentName: string;
  capability: string;
  winRate: number;
  avgScore: number;
  strengths: string[];
  weaknesses: string[];
  criteria: TrainingReport["criteria"];
}

async function generateCoachingAdvice(ctx: CoachingContext): Promise<string> {
  try {
    const anthropic = new Anthropic();

    const criteriaBreakdown = ctx.criteria
      .map(
        (c) =>
          `- ${c.name} (weight ${(c.weight * 100).toFixed(0)}%): avg ${(c.avgScore * 100).toFixed(0)}%, trend: ${c.trend}, range: ${(c.worst * 100).toFixed(0)}%-${(c.best * 100).toFixed(0)}%`
      )
      .join("\n");

    const prompt = `You are a concise AI agent coach. An agent named "${ctx.agentName}" has been training on the "${ctx.capability}" capability against a sparring partner.

Performance summary:
- Win rate: ${(ctx.winRate * 100).toFixed(0)}%
- Average weighted score: ${(ctx.avgScore * 100).toFixed(0)}%
- Strengths: ${ctx.strengths.join(", ")}
- Weaknesses: ${ctx.weaknesses.join(", ")}

Per-criterion breakdown:
${criteriaBreakdown}

Give 2-3 sentences of specific, actionable coaching advice. Focus on the weaknesses and what concrete changes would improve them. Be direct and practical — no fluff.`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-20250414",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";
    return text.trim() || "No coaching advice could be generated.";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[training-report] Coaching advice generation failed:", msg);
    return `Coaching advice unavailable (${msg}). Focus on improving: ${ctx.weaknesses.join(", ")}.`;
  }
}
