// POST /api/arena/middle-out — Solo AutoTune loop with constraint-based scoring.
// No opponent needed. Agent runs challenges → deterministic constraint scoring →
// analyze failures → improve prompt → keep/revert based on weissman score.
// 4-axis scoring: accuracy, speed, cost, reliability.
export const maxDuration = 300; // 5 minutes max

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { verifyArenaAdminAuth } from "@/lib/arena/admin-auth";
import {
  getActivePromptVersion,
  createPromptVersion,
  activatePromptVersion,
  revertToVersion,
} from "@/lib/arena/prompt-manager";
import { proposeImprovedPrompt, promptDiff } from "@/lib/arena/autotune";
import {
  batchScoreOutputs,
  aggregateScores,
  getOrGenerateConstraintChallenges,
  type ConstraintChallenge,
  type ChallengeRun,
  type FactorWeights,
  type IterationScores,
} from "@/lib/arena/constraint-scorer";
import Anthropic from "@anthropic-ai/sdk";

const autotuneV2Schema = z.object({
  agent_slug: z.string().min(3).max(64),
  capability: z.string().min(1).max(200),
  level: z.number().int().min(1).max(4).default(1),
  rounds_per_phase: z.number().int().min(3).max(30).default(10),
  max_iterations: z.number().int().min(1).max(5).default(3),
  // Training goal — human-defined, A2A pre-fill is just a suggestion
  training_goal: z.string().max(500).optional(),
  // Factor weights — user sets what matters most
  factor_weights: z
    .object({
      accuracy: z.number().min(0).max(1),
      speed: z.number().min(0).max(1),
      cost: z.number().min(0).max(1),
      reliability: z.number().min(0).max(1),
    })
    .optional(),
});

interface SoloIterationResult {
  iteration: number;
  scores: {
    accuracy: number;
    speed: number;
    cost: number;
    reliability: number;
    weissman_score: number;
  };
  prompt_version: number;
  weakness_summary: string;
  stopped_reason: string;
  kept: boolean;
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const isServiceRole = await verifyArenaAdminAuth(request);

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

  const parsed = autotuneV2Schema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { agent_slug, capability, level, rounds_per_phase, max_iterations, training_goal } = parsed.data;

  // Normalize factor weights to sum to 1
  const rawWeights = parsed.data.factor_weights ?? { accuracy: 0.4, speed: 0.2, cost: 0.2, reliability: 0.2 };
  const weightSum = rawWeights.accuracy + rawWeights.speed + rawWeights.cost + rawWeights.reliability;
  const factorWeights: FactorWeights = weightSum > 0
    ? {
        accuracy: rawWeights.accuracy / weightSum,
        speed: rawWeights.speed / weightSum,
        cost: rawWeights.cost / weightSum,
        reliability: rawWeights.reliability / weightSum,
      }
    : { accuracy: 0.4, speed: 0.2, cost: 0.2, reliability: 0.2 };

  // Verify agent exists
  const admin = createAdminClient();
  const { data: agent } = await admin
    .from("agents")
    .select("id, name, slug, description, mcp_endpoint, capability_schema")
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
      { status: 400 },
    );
  }

  // ============================================================
  // Step 1: Generate constraint challenge set (one-time expensive step)
  // ============================================================
  console.log(`[middle-out] Generating ${rounds_per_phase} constraint challenges for ${agent_slug} / ${capability} L${level}...`);

  let challengeSet: ConstraintChallenge[];
  try {
    challengeSet = await getOrGenerateConstraintChallenges({
      agentName: agent.name as string,
      agentDescription: agent.description as string | null,
      capability,
      level,
      count: rounds_per_phase,
      trainingGoal: training_goal,
      factorWeights,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[middle-out] Challenge generation failed:", errMsg);
    return NextResponse.json({ error: `Failed to generate challenge set: ${errMsg}` }, { status: 500 });
  }

  if (challengeSet.length === 0) {
    return NextResponse.json(
      { error: "Challenge generation returned empty set — Sonnet may have returned non-JSON. Check server logs for raw response." },
      { status: 500 },
    );
  }

  console.log(`[middle-out] Generated ${challengeSet.length} challenges. Starting solo loop...`);

  // ============================================================
  // Step 2: Solo AutoTune loop
  // ============================================================
  const iterations: SoloIterationResult[] = [];
  let currentVersionId = activeVersion.id;
  let previousScores: IterationScores | null = null;

  for (let iter = 1; iter <= max_iterations; iter++) {
    console.log(`[middle-out] Iteration ${iter}/${max_iterations}`);

    // Run agent through all challenges
    const currentVersion = await getActivePromptVersion(agent.id, capability);
    if (!currentVersion) break;

    const scores = await runChallengeSet(
      agent.mcp_endpoint as string,
      currentVersion.system_prompt,
      currentVersion.model,
      capability,
      challengeSet,
      factorWeights,
    );

    console.log(`[middle-out] Iteration ${iter} scores — accuracy: ${scores.accuracy.toFixed(3)}, speed: ${scores.speed.toFixed(3)}, cost: ${scores.cost.toFixed(3)}, reliability: ${scores.reliability.toFixed(3)}, weissman: ${scores.weissman_score.toFixed(3)}`);

    // First iteration = baseline, just record scores
    if (iter === 1) {
      const weakSummary = scores.worst_constraints.length > 0
        ? `Weakest: ${scores.worst_constraints.slice(0, 3).map((c) => `${c.name} (${(c.fail_rate * 100).toFixed(0)}% fail)`).join(", ")}`
        : "No constraint failures";

      iterations.push({
        iteration: iter,
        scores: {
          accuracy: scores.accuracy,
          speed: scores.speed,
          cost: scores.cost,
          reliability: scores.reliability,
          weissman_score: scores.weissman_score,
        },
        prompt_version: currentVersion.version,
        weakness_summary: weakSummary,
        stopped_reason: "baseline",
        kept: true,
      });

      // If already perfect, stop
      if (scores.weissman_score >= 0.95) {
        iterations[iterations.length - 1].stopped_reason = "near_perfect";
        break;
      }

      previousScores = scores;
      // Continue to improvement phase
    }

    // For iterations after the first: compare with previous
    if (iter > 1 && previousScores) {
      const delta = scores.weissman_score - previousScores.weissman_score;
      const kept = delta > 0;

      const weakSummary = scores.worst_constraints.length > 0
        ? `Weakest: ${scores.worst_constraints.slice(0, 3).map((c) => `${c.name} (${(c.fail_rate * 100).toFixed(0)}% fail)`).join(", ")}`
        : "No constraint failures";

      if (!kept) {
        // Revert
        console.log(`[middle-out] Weissman delta ${delta.toFixed(4)} — reverting`);
        await revertToVersion(currentVersionId);

        iterations.push({
          iteration: iter,
          scores: {
            accuracy: scores.accuracy,
            speed: scores.speed,
            cost: scores.cost,
            reliability: scores.reliability,
            weissman_score: scores.weissman_score,
          },
          prompt_version: currentVersion.version,
          weakness_summary: weakSummary,
          stopped_reason: "regressed",
          kept: false,
        });
        break;
      }

      console.log(`[middle-out] Weissman delta +${delta.toFixed(4)} — keeping`);
      currentVersionId = currentVersion.id;

      iterations.push({
        iteration: iter,
        scores: {
          accuracy: scores.accuracy,
          speed: scores.speed,
          cost: scores.cost,
          reliability: scores.reliability,
          weissman_score: scores.weissman_score,
        },
        prompt_version: currentVersion.version,
        weakness_summary: weakSummary,
        stopped_reason: "improved",
        kept: true,
      });

      previousScores = scores;

      if (scores.weissman_score >= 0.95) {
        iterations[iterations.length - 1].stopped_reason = "near_perfect";
        break;
      }
    }

    // Don't propose improvement on the last iteration (nothing to test against)
    if (iter >= max_iterations) break;

    // Propose improved prompt based on constraint failures
    const weaknessContext = scores.worst_constraints
      .map((c) => `- ${c.name}: ${(c.fail_rate * 100).toFixed(0)}% fail rate, avg score ${c.avg_score.toFixed(2)}`)
      .join("\n");

    try {
      const newPromptText = await proposeImprovedPromptFromConstraints({
        currentPrompt: currentVersion.system_prompt,
        capability,
        weaknessContext,
        trainingGoal: training_goal,
        factorWeights,
        scores,
      });

      // Save and activate candidate
      const candidateVersion = await createPromptVersion({
        agent_id: agent.id,
        capability,
        system_prompt: newPromptText,
        model: currentVersion.model,
        max_tokens: currentVersion.max_tokens,
        temperature: currentVersion.temperature,
        elo_at_creation: undefined,
      });

      const previousVersionId = currentVersionId;
      currentVersionId = candidateVersion.id;
      await activatePromptVersion(candidateVersion.id);

      // Log the diff
      const diff = promptDiff(currentVersion.system_prompt, newPromptText);
      console.log(`[middle-out] Activated candidate v${candidateVersion.version}`);

      // Log to autotune_runs
      await admin.from("autotune_runs").insert({
        agent_id: agent.id,
        capability,
        iteration: iter,
        baseline_version_id: previousVersionId,
        baseline_elo: null,
        baseline_record: null,
        candidate_version_id: candidateVersion.id,
        candidate_elo: null,
        candidate_record: null,
        elo_delta: null,
        kept: null, // TBD — will be determined next iteration
        stopped_reason: "pending_evaluation",
        weakness_analysis: weaknessContext,
        prompt_diff: diff,
        completed_at: new Date().toISOString(),
      });

      // Brief pause for any caching
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error("[middle-out] Prompt improvement failed:", err);
      iterations.push({
        iteration: iter,
        scores: {
          accuracy: scores.accuracy,
          speed: scores.speed,
          cost: scores.cost,
          reliability: scores.reliability,
          weissman_score: scores.weissman_score,
        },
        prompt_version: currentVersion.version,
        weakness_summary: "Prompt generation failed",
        stopped_reason: "prompt_generation_error",
        kept: true, // Keep current version
      });
      break;
    }
  }

  // Build response with iteration 1 (start) and iteration N (end) dots
  const startScores = iterations[0]?.scores ?? { accuracy: 0, speed: 0, cost: 0, reliability: 0, weissman_score: 0 };
  const endScores = iterations[iterations.length - 1]?.scores ?? startScores;

  const improvement = {
    accuracy: endScores.accuracy - startScores.accuracy,
    speed: endScores.speed - startScores.speed,
    cost: endScores.cost - startScores.cost,
    reliability: endScores.reliability - startScores.reliability,
    weissman_score: endScores.weissman_score - startScores.weissman_score,
  };

  // Save run to middle_out_runs for history
  await admin.from("middle_out_runs").insert({
    agent_id: agent.id,
    capability,
    level,
    training_goal: training_goal ?? null,
    factor_weights: factorWeights,
    start_dot: startScores,
    end_dot: endScores,
    improvement,
    iterations,
    challenges_used: challengeSet.length,
    weissman_start: startScores.weissman_score,
    weissman_end: endScores.weissman_score,
  });

  return NextResponse.json({
    agent: agent_slug,
    capability,
    level,
    training_goal: training_goal ?? null,
    factor_weights: factorWeights,
    iterations,
    start_dot: startScores,
    end_dot: endScores,
    target_dot: factorWeights,
    improvement,
    challenges_used: challengeSet.length,
  });
}

// ============================================================
// Helpers
// ============================================================

/**
 * Run an agent through a full challenge set, then batch-score all outputs
 * in ONE judge call. Returns aggregated 4-axis scores.
 */
async function runChallengeSet(
  mcpEndpoint: string,
  systemPrompt: string,
  model: string,
  capability: string,
  challenges: ConstraintChallenge[],
  factorWeights: FactorWeights,
): Promise<IterationScores> {
  const anthropic = new Anthropic();

  // Step 1: Run agent through all challenges, collect outputs
  const runs: ChallengeRun[] = [];

  for (let i = 0; i < challenges.length; i++) {
    const challenge = challenges[i];
    const start = Date.now();
    let output = "";
    let tokensUsed = 0;

    try {
      const message = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: challenge.prompt }],
      });

      output = message.content[0].type === "text" ? message.content[0].text : "";
      tokensUsed = (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0);
    } catch (err) {
      console.error("[middle-out] Agent call failed:", err);
    }

    runs.push({
      challenge_index: i,
      output,
      latency_ms: Date.now() - start,
      tokens_used: tokensUsed,
    });
  }

  // Step 2: Batch score ALL outputs in one judge call
  const scores = await batchScoreOutputs(challenges, runs);

  return aggregateScores(scores, factorWeights);
}

/**
 * Propose an improved prompt based on constraint failure analysis.
 * Similar to the original proposeImprovedPrompt but uses constraint data.
 */
async function proposeImprovedPromptFromConstraints(params: {
  currentPrompt: string;
  capability: string;
  weaknessContext: string;
  trainingGoal?: string;
  factorWeights: FactorWeights;
  scores: IterationScores;
}): Promise<string> {
  const { currentPrompt, capability, weaknessContext, trainingGoal, factorWeights, scores } = params;

  const anthropic = new Anthropic();

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `You are an expert AI prompt engineer. Given a system prompt and its constraint-based performance data, propose a targeted improvement.

Rules:
- Keep the same output schema — only modify instructional text
- Focus on the weakest constraints and the user's priorities
- Be specific — don't add generic "be better" instructions
- Keep it concise — brevity matters for cost
- Return ONLY the new system prompt text, no explanation, no markdown fences`,

    messages: [{
      role: "user",
      content: `## Current System Prompt
${currentPrompt}

## Capability
${capability}
${trainingGoal ? `\n## Training Goal\n${trainingGoal}` : ""}

## User's Factor Priorities
Accuracy: ${(factorWeights.accuracy * 100).toFixed(0)}% | Speed: ${(factorWeights.speed * 100).toFixed(0)}% | Cost: ${(factorWeights.cost * 100).toFixed(0)}% | Reliability: ${(factorWeights.reliability * 100).toFixed(0)}%

## Current Scores
Accuracy: ${scores.accuracy.toFixed(3)} | Speed: ${scores.speed.toFixed(3)} | Cost: ${scores.cost.toFixed(3)} | Reliability: ${scores.reliability.toFixed(3)}

## Constraint Failures (worst first)
${weaknessContext || "No specific constraint failures"}

Propose an improved system prompt that addresses the weakest areas while respecting the user's priorities. Return ONLY the new prompt text.`,
    }],
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  let text = content.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:\w+)?\s*/, "").replace(/\s*```$/, "");
  }
  return text;
}
