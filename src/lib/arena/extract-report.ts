// Extract Report Engine — generates comprehensive agent performance reports
// across ALL match types (training, arena, jobs) with per-match detail,
// cost analysis, and pricing recommendations.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JudgmentBreakdown, CriterionScore } from "./types";

// ============================================================
// Output Types
// ============================================================

export interface MatchDetail {
  matchId: string;
  matchType: "undercard" | "championship";
  matchCategory: "training" | "arena" | "job";
  capability: string;
  opponent: { name: string; slug: string };
  side: "a" | "b";
  result: "win" | "loss" | "tie";
  level: number | null;
  promptText: string | null;
  challengeTitle: string | null;
  durationMs: number | null;
  opponentDurationMs: number | null;
  totalScore: number | null;
  opponentTotalScore: number | null;
  criteriaScores: Array<{
    name: string;
    score: number;
    weight: number;
    notes?: string;
  }>;
  speedScore: number | null;
  costEfficiency: number | null;
  schemaCompliance: number | null;
  judgmentReasoning: string | null;
  judgmentConfidence: number | null;
  cost: number;
  apiCost: number;
  opponentCost: number;
  opponentApiCost: number;
  completedAt: string | null;
  createdAt: string;
}

export interface CostAnalysis {
  totalApiCost: number;
  totalAgentCost: number;
  avgApiCostPerMatch: number;
  avgApiCostPerWin: number;
  costPerCapability: Record<string, { apiCost: number; matches: number; avg: number }>;
  margin: number; // agent rate vs api cost ratio
  marginPercent: number;
}

export interface CriterionSummary {
  name: string;
  weight: number;
  avgScore: number;
  trend: "improving" | "declining" | "stable";
  best: number;
  worst: number;
  matchCount: number;
}

export interface ExtractReport {
  agentId: string;
  agentName: string;
  agentSlug: string;
  generatedAt: string;

  // Overall stats
  overall: {
    totalMatches: number;
    wins: number;
    losses: number;
    ties: number;
    winRate: number;
    avgScore: number;
    eloCurrent: number;
    eloByCapability: Record<string, number>;
  };

  // Breakdown by category
  byCategory: {
    training: { matches: number; wins: number; winRate: number };
    arena: { matches: number; wins: number; winRate: number };
    job: { matches: number; wins: number; winRate: number };
  };

  // Per-match detail
  matches: MatchDetail[];

  // Criteria summary across all matches
  criteria: CriterionSummary[];
  strengths: string[];
  weaknesses: string[];

  // Cost analysis
  costs: CostAnalysis;

  // LLM-generated recommendations
  recommendations: {
    pricing: string;
    performance: string;
    readiness: string;
    marketing: string;
  };
}

// ============================================================
// Helpers
// ============================================================

const SPARRING_SLUG = "sparring-partner";
const DEFAULT_ELO = 1200;

function computeTrend(scores: number[]): "improving" | "declining" | "stable" {
  if (scores.length < 3) return "stable";
  const n = scores.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += scores[i];
    sumXY += i * scores[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  if (slope > 0.02) return "improving";
  if (slope < -0.02) return "declining";
  return "stable";
}

function classifyMatch(
  match: Record<string, unknown>,
  sparringId: string | undefined
): "training" | "arena" | "job" {
  // Training = matches against sparring partner
  if (sparringId && (match.agent_a_id === sparringId || match.agent_b_id === sparringId)) {
    return "training";
  }
  // Job = matches with a job_a_id or job_b_id (agent was hired)
  if (match.job_a_id || match.job_b_id) {
    return "job";
  }
  // Everything else = arena (competitive)
  return "arena";
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ============================================================
// Core Function
// ============================================================

export async function generateExtractReport(
  admin: SupabaseClient,
  agentId: string,
  options: { limit?: number } = {}
): Promise<ExtractReport> {
  const limit = options.limit ?? 200;

  // ── 1. Fetch the agent ────────────────────────────────────────────
  const { data: agent, error: agentErr } = await admin
    .from("agents")
    .select("id, name, slug, capability_schema")
    .eq("id", agentId)
    .single();

  if (agentErr || !agent) throw new Error("Agent not found");

  // ── 2. Find sparring partner ID ───────────────────────────────────
  const { data: sparring } = await admin
    .from("agents")
    .select("id")
    .eq("slug", SPARRING_SLUG)
    .single();
  const sparringId = sparring?.id as string | undefined;

  // ── 3. Query ALL completed matches involving this agent ───────────
  const { data: matches, error: matchErr } = await admin
    .from("arena_matches")
    .select(
      `id, agent_a_id, agent_b_id, capability, winner, match_type, level,
       prompt_text, job_a_id, job_b_id,
       response_a, response_b,
       duration_a_ms, duration_b_ms, verified_a, verified_b,
       judgment_reasoning, judgment_confidence, judgment_source, judgment_breakdown,
       cost_a, cost_b, api_cost_a, api_cost_b,
       completed_at, created_at,
       challenge:challenge_id(title)`
    )
    .eq("status", "completed")
    .or(`agent_a_id.eq.${agentId},agent_b_id.eq.${agentId}`)
    .order("completed_at", { ascending: true })
    .limit(limit);

  if (matchErr) throw new Error(`Failed to query matches: ${matchErr.message}`);
  if (!matches || matches.length === 0) {
    throw new Error("No completed matches found for this agent");
  }

  // ── 4. Load opponent agent names (batch) ──────────────────────────
  const opponentIds = new Set<string>();
  for (const m of matches) {
    const oppId = m.agent_a_id === agentId ? m.agent_b_id : m.agent_a_id;
    opponentIds.add(oppId as string);
  }

  const { data: opponents } = await admin
    .from("agents")
    .select("id, name, slug")
    .in("id", [...opponentIds]);

  const opponentMap = new Map<string, { name: string; slug: string }>();
  for (const o of opponents ?? []) {
    opponentMap.set(o.id as string, { name: o.name as string, slug: o.slug as string });
  }

  // ── 5. Fetch all ELO ratings for this agent ──────────────────────
  const { data: ratings } = await admin
    .from("arena_ratings")
    .select("capability, elo")
    .eq("agent_id", agentId);

  const eloByCapability: Record<string, number> = {};
  let primaryElo = DEFAULT_ELO;
  for (const r of ratings ?? []) {
    eloByCapability[r.capability as string] = r.elo as number;
    primaryElo = r.elo as number; // last one, or we'll pick max below
  }
  const currentElo = Math.max(DEFAULT_ELO, ...Object.values(eloByCapability));

  // ── 6. Build per-match detail ─────────────────────────────────────
  const matchDetails: MatchDetail[] = [];
  const criterionMap = new Map<string, { weight: number; scores: number[] }>();
  const totalScores: number[] = [];

  let wins = 0, losses = 0, ties = 0;
  let totalApiCost = 0, totalAgentCost = 0;
  const costByCapability: Record<string, { apiCost: number; matches: number }> = {};
  const categoryStats = {
    training: { matches: 0, wins: 0 },
    arena: { matches: 0, wins: 0 },
    job: { matches: 0, wins: 0 },
  };
  let winApiCostTotal = 0;
  let winCount = 0;

  for (const match of matches) {
    const side: "a" | "b" = match.agent_a_id === agentId ? "a" : "b";
    const oppSide: "a" | "b" = side === "a" ? "b" : "a";
    const winner = match.winner as string | null;
    const oppId = (side === "a" ? match.agent_b_id : match.agent_a_id) as string;
    const opp = opponentMap.get(oppId) ?? { name: "Unknown", slug: "unknown" };
    const category = classifyMatch(match, sparringId);
    const breakdown = match.judgment_breakdown as JudgmentBreakdown | null;

    // Result
    let result: "win" | "loss" | "tie";
    if (winner === side) { result = "win"; wins++; }
    else if (winner === "tie") { result = "tie"; ties++; }
    else { result = "loss"; losses++; }

    // Category stats
    categoryStats[category].matches++;
    if (result === "win") categoryStats[category].wins++;

    // Costs
    const agentCost = (side === "a" ? match.cost_a : match.cost_b) as number ?? 0;
    const apiCost = (side === "a" ? match.api_cost_a : match.api_cost_b) as number ?? 0;
    const oppCost = (oppSide === "a" ? match.cost_a : match.cost_b) as number ?? 0;
    const oppApiCost = (oppSide === "a" ? match.api_cost_a : match.api_cost_b) as number ?? 0;

    totalApiCost += apiCost;
    totalAgentCost += agentCost;

    if (result === "win") {
      winApiCostTotal += apiCost;
      winCount++;
    }

    const cap = match.capability as string;
    if (!costByCapability[cap]) costByCapability[cap] = { apiCost: 0, matches: 0 };
    costByCapability[cap].apiCost += apiCost;
    costByCapability[cap].matches++;

    // Scores from breakdown
    let criteriaScores: Array<{ name: string; score: number; weight: number; notes?: string }> = [];
    let totalScore: number | null = null;
    let opponentTotalScore: number | null = null;
    let speedScore: number | null = null;
    let costEfficiency: number | null = null;
    let schemaCompliance: number | null = null;

    if (breakdown) {
      const cs = side === "a" ? breakdown.criteria_scores_a : breakdown.criteria_scores_b;
      criteriaScores = (cs ?? []).map((c: CriterionScore) => ({
        name: c.name,
        score: c.score,
        weight: c.weight,
        notes: c.notes,
      }));
      totalScore = side === "a" ? breakdown.total_a : breakdown.total_b;
      opponentTotalScore = oppSide === "a" ? breakdown.total_a : breakdown.total_b;
      speedScore = side === "a" ? breakdown.speed_score_a : breakdown.speed_score_b;
      costEfficiency = side === "a" ? breakdown.cost_efficiency_a : breakdown.cost_efficiency_b;
      schemaCompliance = side === "a" ? breakdown.schema_compliance_a : breakdown.schema_compliance_b;

      if (totalScore != null) totalScores.push(totalScore);

      for (const c of cs ?? []) {
        const existing = criterionMap.get(c.name);
        if (existing) {
          existing.scores.push(c.score);
        } else {
          criterionMap.set(c.name, { weight: c.weight, scores: [c.score] });
        }
      }
    }

    // Challenge title from join
    const challengeRaw = match.challenge as { title: string } | { title: string }[] | null;
    const challenge = Array.isArray(challengeRaw) ? challengeRaw[0] ?? null : challengeRaw;

    matchDetails.push({
      matchId: match.id as string,
      matchType: match.match_type as "undercard" | "championship",
      matchCategory: category,
      capability: cap,
      opponent: opp,
      side,
      result,
      level: match.level as number | null,
      promptText: match.prompt_text as string | null,
      challengeTitle: challenge?.title ?? null,
      durationMs: (side === "a" ? match.duration_a_ms : match.duration_b_ms) as number | null,
      opponentDurationMs: (oppSide === "a" ? match.duration_a_ms : match.duration_b_ms) as number | null,
      totalScore,
      opponentTotalScore,
      criteriaScores,
      speedScore,
      costEfficiency,
      schemaCompliance,
      judgmentReasoning: match.judgment_reasoning as string | null,
      judgmentConfidence: match.judgment_confidence as number | null,
      cost: agentCost,
      apiCost,
      opponentCost: oppCost,
      opponentApiCost: oppApiCost,
      completedAt: match.completed_at as string | null,
      createdAt: match.created_at as string,
    });
  }

  // ── 7. Build criteria summary ─────────────────────────────────────
  const criteriaSummary: CriterionSummary[] = [];
  for (const [name, data] of criterionMap) {
    const scores = data.scores;
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    criteriaSummary.push({
      name,
      weight: data.weight,
      avgScore: round3(avg),
      trend: computeTrend(scores),
      best: round3(Math.max(...scores)),
      worst: round3(Math.min(...scores)),
      matchCount: scores.length,
    });
  }

  const sorted = [...criteriaSummary].sort((a, b) => b.avgScore - a.avgScore);
  const strengths = sorted.slice(0, 2).map((c) => c.name);
  const weaknesses = sorted.length > 2 ? sorted.slice(-2).map((c) => c.name) : [];

  // ── 8. Cost analysis ──────────────────────────────────────────────
  const totalMatches = matches.length;
  const avgApiCostPerMatch = totalMatches > 0 ? totalApiCost / totalMatches : 0;
  const avgApiCostPerWin = winCount > 0 ? winApiCostTotal / winCount : 0;
  const margin = totalAgentCost > 0 ? totalAgentCost - totalApiCost : 0;
  const marginPercent = totalAgentCost > 0 ? ((totalAgentCost - totalApiCost) / totalAgentCost) * 100 : 0;

  const costPerCapability: CostAnalysis["costPerCapability"] = {};
  for (const [cap, data] of Object.entries(costByCapability)) {
    costPerCapability[cap] = {
      apiCost: round3(data.apiCost),
      matches: data.matches,
      avg: round3(data.matches > 0 ? data.apiCost / data.matches : 0),
    };
  }

  const costs: CostAnalysis = {
    totalApiCost: round3(totalApiCost),
    totalAgentCost: round3(totalAgentCost),
    avgApiCostPerMatch: round3(avgApiCostPerMatch),
    avgApiCostPerWin: round3(avgApiCostPerWin),
    costPerCapability,
    margin: round3(margin),
    marginPercent: round3(marginPercent),
  };

  // ── 9. Overall stats ──────────────────────────────────────────────
  const winRate = totalMatches > 0 ? wins / totalMatches : 0;
  const avgScore = totalScores.length > 0
    ? totalScores.reduce((s, v) => s + v, 0) / totalScores.length
    : 0;

  const catRate = (c: { matches: number; wins: number }) =>
    c.matches > 0 ? round3(c.wins / c.matches) : 0;

  // ── 10. Generate LLM recommendations ──────────────────────────────
  const recommendations = await generateRecommendations({
    agentName: agent.name as string,
    totalMatches,
    winRate,
    avgScore,
    costs,
    strengths,
    weaknesses,
    criteria: criteriaSummary,
    categoryStats,
    eloByCapability,
  });

  return {
    agentId,
    agentName: agent.name as string,
    agentSlug: agent.slug as string,
    generatedAt: new Date().toISOString(),
    overall: {
      totalMatches,
      wins,
      losses,
      ties,
      winRate: round3(winRate),
      avgScore: round3(avgScore),
      eloCurrent: currentElo,
      eloByCapability,
    },
    byCategory: {
      training: { matches: categoryStats.training.matches, wins: categoryStats.training.wins, winRate: catRate(categoryStats.training) },
      arena: { matches: categoryStats.arena.matches, wins: categoryStats.arena.wins, winRate: catRate(categoryStats.arena) },
      job: { matches: categoryStats.job.matches, wins: categoryStats.job.wins, winRate: catRate(categoryStats.job) },
    },
    matches: matchDetails,
    criteria: criteriaSummary,
    strengths,
    weaknesses,
    costs,
    recommendations,
  };
}

// ============================================================
// LLM Recommendations
// ============================================================

interface RecommendationContext {
  agentName: string;
  totalMatches: number;
  winRate: number;
  avgScore: number;
  costs: CostAnalysis;
  strengths: string[];
  weaknesses: string[];
  criteria: CriterionSummary[];
  categoryStats: Record<string, { matches: number; wins: number }>;
  eloByCapability: Record<string, number>;
}

async function generateRecommendations(
  ctx: RecommendationContext
): Promise<ExtractReport["recommendations"]> {
  const fallback = {
    pricing: "Insufficient data for pricing recommendation.",
    performance: "Continue training to build a performance baseline.",
    readiness: "More matches needed to assess arena readiness.",
    marketing: "Build a track record before marketing this agent.",
  };

  try {
    const anthropic = new Anthropic();

    const criteriaBreakdown = ctx.criteria
      .map((c) => `- ${c.name} (wt ${(c.weight * 100).toFixed(0)}%): avg ${(c.avgScore * 100).toFixed(0)}%, trend: ${c.trend}, range ${(c.worst * 100).toFixed(0)}%-${(c.best * 100).toFixed(0)}%`)
      .join("\n");

    const eloBreakdown = Object.entries(ctx.eloByCapability)
      .map(([cap, elo]) => `- ${cap}: ${elo}`)
      .join("\n");

    const catBreakdown = Object.entries(ctx.categoryStats)
      .filter(([, s]) => s.matches > 0)
      .map(([cat, s]) => `- ${cat}: ${s.matches} matches, ${s.wins} wins (${s.matches > 0 ? Math.round((s.wins / s.matches) * 100) : 0}%)`)
      .join("\n");

    const prompt = `You are an expert AI agent analyst. Generate 4 recommendations for the agent "${ctx.agentName}" based on this performance data.

PERFORMANCE:
- Total matches: ${ctx.totalMatches} | Win rate: ${(ctx.winRate * 100).toFixed(0)}% | Avg score: ${(ctx.avgScore * 100).toFixed(0)}%
- Strengths: ${ctx.strengths.join(", ") || "None identified"}
- Weaknesses: ${ctx.weaknesses.join(", ") || "None identified"}

BY CATEGORY:
${catBreakdown || "No category breakdown available"}

ELO RATINGS:
${eloBreakdown || "No ratings yet"}

CRITERIA:
${criteriaBreakdown || "No criteria data"}

COSTS:
- Total API cost: $${ctx.costs.totalApiCost.toFixed(4)}
- Avg cost/match: $${ctx.costs.avgApiCostPerMatch.toFixed(4)}
- Avg cost/win: $${ctx.costs.avgApiCostPerWin.toFixed(4)}
- Agent billing total: $${ctx.costs.totalAgentCost.toFixed(4)}
- Margin: ${ctx.costs.marginPercent.toFixed(1)}%

Return exactly 4 sections, each 2-3 sentences. Be specific and data-driven.

PRICING: Recommend a per-call price based on API costs, win rate, and value delivered. Reference specific numbers.
PERFORMANCE: What to improve and how, based on criteria scores and trends.
READINESS: Is this agent ready for competitive arena matches? What ELO/win rate thresholds should they hit first?
MARKETING: What are this agent's selling points based on strengths and track record?

Format as:
PRICING: ...
PERFORMANCE: ...
READINESS: ...
MARKETING: ...`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";

    // Parse sections
    const sections: Record<string, string> = {};
    for (const key of ["PRICING", "PERFORMANCE", "READINESS", "MARKETING"]) {
      const regex = new RegExp(`${key}:\\s*(.+?)(?=(?:PRICING|PERFORMANCE|READINESS|MARKETING):|$)`, "s");
      const match = regex.exec(text);
      sections[key.toLowerCase()] = match?.[1]?.trim() ?? fallback[key.toLowerCase() as keyof typeof fallback];
    }

    return {
      pricing: sections.pricing ?? fallback.pricing,
      performance: sections.performance ?? fallback.performance,
      readiness: sections.readiness ?? fallback.readiness,
      marketing: sections.marketing ?? fallback.marketing,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extract-report] Recommendation generation failed:", msg);
    return fallback;
  }
}
