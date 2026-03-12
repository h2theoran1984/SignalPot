// POST /api/arena/autotune — Automated prompt optimization loop.
// Iteratively: grind → analyze weaknesses → propose new prompt → hot-swap → grind → compare ELO.
export const maxDuration = 300; // 5 minutes max

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import {
  getActivePromptVersion,
  createPromptVersion,
  activatePromptVersion,
  revertToVersion,
} from "@/lib/arena/prompt-manager";
import {
  analyzeWeaknesses,
  proposeImprovedPrompt,
  promptDiff,
} from "@/lib/arena/autotune";
import type { JudgmentBreakdown } from "@/lib/arena/types";

const autotuneSchema = z.object({
  agent_slug: z.string().min(3).max(64),
  capability: z.string().min(1).max(200),
  rounds_per_phase: z.number().int().min(3).max(30).default(10),
  max_iterations: z.number().int().min(1).max(5).default(3),
  level: z.number().int().min(1).max(4).default(1),
});

interface IterationResult {
  iteration: number;
  baseline_elo: number;
  baseline_record: { wins: number; losses: number; ties: number };
  candidate_elo: number | null;
  candidate_record: { wins: number; losses: number; ties: number } | null;
  elo_delta: number | null;
  kept: boolean;
  prompt_version: number;
  weakness_summary: string;
  stopped_reason: string;
}

export async function POST(request: NextRequest) {
  // Accept service-role key for admin/CLI access (autotune is admin-only)
  const authHeader = request.headers.get("authorization");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isServiceRole =
    serviceRoleKey &&
    authHeader === `Bearer ${serviceRoleKey}`;

  const auth = isServiceRole ? null : await getAuthContext(request);
  if (!isServiceRole && !auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = autotuneSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { agent_slug, capability, rounds_per_phase, max_iterations, level } = parsed.data;

  // Verify agent exists
  const admin = createAdminClient();
  const { data: agent } = await admin
    .from("agents")
    .select("id, name, slug")
    .eq("slug", agent_slug)
    .eq("status", "active")
    .single();

  if (!agent) {
    return NextResponse.json({ error: `Agent '${agent_slug}' not found` }, { status: 404 });
  }

  // Verify prompt version exists
  const activeVersion = await getActivePromptVersion(agent.id, capability);
  if (!activeVersion) {
    return NextResponse.json(
      { error: `No active prompt version for ${agent_slug} / ${capability}. Run seed-prompts first.` },
      { status: 400 }
    );
  }

  // Build internal grind URL + auth headers
  const baseUrl = request.url.replace(/\/api\/arena\/autotune.*$/, "");
  const grindUrl = `${baseUrl}/api/arena/grind`;

  const authHeaders: Record<string, string> = {};
  if (authHeader) authHeaders["Authorization"] = authHeader;
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) authHeaders["Cookie"] = cookieHeader;

  const iterations: IterationResult[] = [];
  let currentVersionId = activeVersion.id;

  for (let iter = 1; iter <= max_iterations; iter++) {
    console.log(`[autotune] Iteration ${iter}/${max_iterations} for ${agent_slug} / ${capability}`);

    // 1. Get current ELO
    const { data: ratingRow } = await admin
      .from("arena_ratings")
      .select("elo")
      .eq("agent_id", agent.id)
      .eq("capability", capability)
      .single();

    const baselineElo = (ratingRow?.elo as number) ?? 1200;

    // 2. Baseline grind
    console.log(`[autotune] Running baseline grind (${rounds_per_phase} rounds)...`);
    const baselineResult = await runGrind(grindUrl, authHeaders, {
      agent_slug,
      capability,
      level,
      max_rounds: rounds_per_phase,
      stop_on_loss: false,
    });

    if (!baselineResult) {
      iterations.push({
        iteration: iter,
        baseline_elo: baselineElo,
        baseline_record: { wins: 0, losses: 0, ties: 0 },
        candidate_elo: null,
        candidate_record: null,
        elo_delta: null,
        kept: false,
        prompt_version: activeVersion.version,
        weakness_summary: "Grind failed",
        stopped_reason: "grind_error",
      });
      break;
    }

    // 3. Fetch judgment breakdowns for the matches
    const matchIds = baselineResult.rounds
      .filter((r: GrindRound) => r.match_id)
      .map((r: GrindRound) => r.match_id);

    const breakdowns = await fetchBreakdowns(admin, matchIds);
    const reasonings = baselineResult.rounds.map((r: GrindRound) => r.reasoning ?? "");
    const winners = baselineResult.rounds.map((r: GrindRound) =>
      r.winner === "a" ? "a" as const : r.winner === "b" ? "b" as const : "tie" as const
    );

    // 4. Analyze weaknesses
    const weaknessReport = analyzeWeaknesses({ breakdowns, reasonings, winners });
    console.log(`[autotune] Weakness: ${weaknessReport.summary}`);

    // If win rate is already 100%, no improvement needed
    if (weaknessReport.win_rate >= 1.0 && breakdowns.length > 0) {
      iterations.push({
        iteration: iter,
        baseline_elo: baselineResult.current_elo ?? baselineElo,
        baseline_record: baselineResult.record,
        candidate_elo: null,
        candidate_record: null,
        elo_delta: null,
        kept: true,
        prompt_version: activeVersion.version,
        weakness_summary: weaknessReport.summary,
        stopped_reason: "perfect_score",
      });
      break;
    }

    // 5. Propose improved prompt
    const currentVersion = await getActivePromptVersion(agent.id, capability);
    if (!currentVersion) break;

    let newPromptText: string;
    try {
      newPromptText = await proposeImprovedPrompt({
        currentPrompt: currentVersion.system_prompt,
        capability,
        weaknessReport,
      });
    } catch (err) {
      console.error(`[autotune] Prompt generation failed:`, err);
      iterations.push({
        iteration: iter,
        baseline_elo: baselineResult.current_elo ?? baselineElo,
        baseline_record: baselineResult.record,
        candidate_elo: null,
        candidate_record: null,
        elo_delta: null,
        kept: false,
        prompt_version: currentVersion.version,
        weakness_summary: weaknessReport.summary,
        stopped_reason: "prompt_generation_error",
      });
      break;
    }

    // 6. Save and activate candidate
    const candidateVersion = await createPromptVersion({
      agent_id: agent.id,
      capability,
      system_prompt: newPromptText,
      model: currentVersion.model,
      max_tokens: currentVersion.max_tokens,
      temperature: currentVersion.temperature,
      elo_at_creation: baselineResult.current_elo ?? baselineElo,
    });

    const previousVersionId = currentVersionId;
    await activatePromptVersion(candidateVersion.id);
    currentVersionId = candidateVersion.id;

    console.log(`[autotune] Activated candidate v${candidateVersion.version}, waiting for propagation...`);

    // 7. Wait for cache propagation (text-analyzer has 60s TTL)
    await sleep(5000);

    // 8. Candidate grind
    console.log(`[autotune] Running candidate grind (${rounds_per_phase} rounds)...`);
    const candidateResult = await runGrind(grindUrl, authHeaders, {
      agent_slug,
      capability,
      level,
      max_rounds: rounds_per_phase,
      stop_on_loss: false,
    });

    if (!candidateResult) {
      // Revert on grind failure
      await revertToVersion(previousVersionId);
      currentVersionId = previousVersionId;

      iterations.push({
        iteration: iter,
        baseline_elo: baselineResult.current_elo ?? baselineElo,
        baseline_record: baselineResult.record,
        candidate_elo: null,
        candidate_record: null,
        elo_delta: null,
        kept: false,
        prompt_version: candidateVersion.version,
        weakness_summary: weaknessReport.summary,
        stopped_reason: "candidate_grind_error",
      });
      break;
    }

    // 9. Compare ELO
    const candidateElo = candidateResult.current_elo ?? baselineElo;
    const baseElo = baselineResult.current_elo ?? baselineElo;
    const eloDelta = candidateElo - baseElo;

    const kept = eloDelta > 0;

    if (!kept) {
      // Revert
      console.log(`[autotune] ELO delta ${eloDelta} — reverting to v${currentVersion.version}`);
      await revertToVersion(previousVersionId);
      currentVersionId = previousVersionId;
    } else {
      console.log(`[autotune] ELO delta +${eloDelta} — keeping v${candidateVersion.version}`);
    }

    // 10. Log to autotune_runs
    const diff = promptDiff(currentVersion.system_prompt, newPromptText);

    await admin.from("autotune_runs").insert({
      agent_id: agent.id,
      capability,
      iteration: iter,
      baseline_version_id: previousVersionId,
      baseline_elo: baseElo,
      baseline_record: baselineResult.record,
      candidate_version_id: candidateVersion.id,
      candidate_elo: candidateElo,
      candidate_record: candidateResult.record,
      elo_delta: eloDelta,
      kept,
      stopped_reason: kept ? "improved" : "regressed",
      weakness_analysis: weaknessReport.summary,
      prompt_diff: diff,
      judgment_summaries: baselineResult.rounds.map((r: GrindRound) => ({
        round: r.round,
        winner: r.winner,
        reasoning: r.reasoning,
        confidence: r.confidence,
      })),
      completed_at: new Date().toISOString(),
    });

    iterations.push({
      iteration: iter,
      baseline_elo: baseElo,
      baseline_record: baselineResult.record,
      candidate_elo: candidateElo,
      candidate_record: candidateResult.record,
      elo_delta: eloDelta,
      kept,
      prompt_version: kept ? candidateVersion.version : currentVersion.version,
      weakness_summary: weaknessReport.summary,
      stopped_reason: kept ? "improved" : "regressed",
    });

    // Stop if we didn't improve (no point continuing)
    if (!kept) break;
  }

  // Final ELO
  const { data: finalRating } = await admin
    .from("arena_ratings")
    .select("elo")
    .eq("agent_id", agent.id)
    .eq("capability", capability)
    .single();

  const startElo = iterations[0]?.baseline_elo ?? 1200;
  const finalElo = (finalRating?.elo as number) ?? startElo;

  return NextResponse.json({
    agent: agent_slug,
    capability,
    level,
    iterations,
    final_elo: finalElo,
    total_elo_gain: finalElo - startElo,
    active_version: iterations[iterations.length - 1]?.prompt_version ?? activeVersion.version,
  });
}

// ============================================================
// Helpers
// ============================================================

interface GrindRound {
  round: number;
  match_id: string;
  winner: string | null;
  reasoning: string | null;
  confidence: number | null;
  elo: { agent_elo: number; change: number } | null;
  cost: number;
  duration_ms: number;
}

interface GrindResult {
  rounds: GrindRound[];
  record: { wins: number; losses: number; ties: number };
  current_elo: number | null;
  total_spent_usd: number;
  stopped_reason: string;
}

async function runGrind(
  grindUrl: string,
  authHeaders: Record<string, string>,
  params: {
    agent_slug: string;
    capability: string;
    level: number;
    max_rounds: number;
    stop_on_loss: boolean;
  }
): Promise<GrindResult | null> {
  try {
    const res = await fetch(grindUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[autotune] Grind failed (${res.status}):`, errBody);
      return null;
    }

    return (await res.json()) as GrindResult;
  } catch (err) {
    console.error("[autotune] Grind fetch error:", err);
    return null;
  }
}

async function fetchBreakdowns(
  admin: ReturnType<typeof createAdminClient>,
  matchIds: string[]
): Promise<JudgmentBreakdown[]> {
  if (matchIds.length === 0) return [];

  const { data } = await admin
    .from("arena_matches")
    .select("judgment_breakdown")
    .in("id", matchIds)
    .not("judgment_breakdown", "is", null);

  if (!data) return [];

  return data
    .map((row) => row.judgment_breakdown as JudgmentBreakdown | null)
    .filter((bd): bd is JudgmentBreakdown => bd !== null);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
