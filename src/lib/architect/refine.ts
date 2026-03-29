/**
 * The Architect — Refinement Loop
 *
 * Iteratively improves an agent by:
 *   1. Running a match against the Sparring Partner
 *   2. Reading the judge's feedback
 *   3. Rewriting the system prompt to address weaknesses
 *   4. Updating the agent in the DB
 *   5. Checking stopping conditions
 */

import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { ARCHITECT_MODEL } from "./constants";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface RefineInput {
  agent_slug: string;
  max_iterations?: number;
  target_score?: number;
  opponent_slug?: string;
  opponent_level?: number;
  capability?: string;
}

export interface IterationRecord {
  version: number;
  system_prompt: string;
  match_id: string | null;
  score: number | null;
  confidence: number | null;
  winner: string | null;
  reasoning: string | null;
  breakdown: Record<string, unknown> | null;
  timestamp: string;
}

export interface RefineResult {
  agent_slug: string;
  iterations_run: number;
  score_progression: (number | null)[];
  best_version: number;
  current_version: number;
  stopped_reason: string;
  history: IterationRecord[];
}

interface MatchResponse {
  match_id: string;
  status: string;
  agent_a: { slug: string; responded: boolean; response: Record<string, unknown> | null };
  agent_b: { slug: string; responded: boolean; response: Record<string, unknown> | null };
  judgment: {
    winner: string;
    reasoning: string;
    confidence: number;
    source: string;
  } | null;
  elo: Record<string, unknown> | null;
}

/**
 * Fire a match between the agent and the sparring partner via the fight endpoint.
 */
async function fireMatch(
  fightUrl: string,
  authHeaders: Record<string, string>,
  agentSlug: string,
  capability: string,
  level: number
): Promise<MatchResponse | null> {
  try {
    const res = await fetch(fightUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        agent_a_slug: agentSlug,
        agent_b_slug: "sparring-partner",
        capability,
        level,
      }),
    });

    if (!res.ok) {
      console.error(`[architect-refine] Fight failed (${res.status}):`, await res.text().catch(() => ""));
      return null;
    }

    return (await res.json()) as MatchResponse;
  } catch (err) {
    console.error("[architect-refine] Fight fetch error:", err);
    return null;
  }
}

/**
 * Use Claude to rewrite the system prompt based on judgment feedback.
 */
async function rewritePrompt(
  currentPrompt: string,
  capability: string,
  judgment: { winner: string; reasoning: string; confidence: number },
  agentSide: string
): Promise<string> {
  const won = judgment.winner === agentSide;
  const feedbackContext = won
    ? "The agent WON this match, but there may still be areas to improve. Focus on strengthening existing capabilities and addressing any noted weaknesses."
    : "The agent LOST this match. Focus on the specific weaknesses the judge identified and rewrite the prompt to address them while preserving existing strengths.";

  const message = await anthropic.messages.create({
    model: ARCHITECT_MODEL,
    max_tokens: 4096,
    system: `You are The Architect, an expert at iteratively improving AI agent system prompts based on competitive match feedback.

Your job: take the current system prompt and the judge's feedback, then produce an improved version.

Rules:
- Preserve what's working well — don't rewrite sections that aren't related to the feedback
- Address specific weaknesses mentioned in the judgment
- Keep the same overall structure (role, expertise, frameworks, output standards, methodology, guardrails)
- Make targeted improvements, not wholesale rewrites
- The agent must still output structured JSON matching its capability schema
- Keep the "You respond with structured JSON" guardrail intact`,
    messages: [
      {
        role: "user",
        content: `Here is the current system prompt for an agent with the "${capability}" capability:

--- CURRENT PROMPT ---
${currentPrompt}
--- END PROMPT ---

Here is the judge's feedback from the latest match:
- Winner: ${judgment.winner === "tie" ? "Tie" : judgment.winner === agentSide ? "Our agent" : "Opponent"}
- Confidence: ${judgment.confidence}
- Reasoning: ${judgment.reasoning}

${feedbackContext}

Rewrite the system prompt to address the feedback. Return ONLY the new system prompt text — no wrapping, no explanation, no markdown code blocks.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from prompt rewrite");
  }

  let text = content.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:\w*)?\s*/, "").replace(/\s*```$/, "");
  }

  return text;
}

/**
 * Extract the agent's score from a match result.
 * Uses judgment confidence as a proxy — weighted by win/loss/tie.
 */
function extractScore(
  match: MatchResponse,
  agentSide: string
): number | null {
  if (!match.judgment) return null;
  const confidence = match.judgment.confidence;

  if (match.judgment.winner === agentSide) {
    // Won: score = 0.5 + (confidence * 0.5) → range [0.5, 1.0]
    return 0.5 + confidence * 0.5;
  } else if (match.judgment.winner === "tie") {
    return 0.5;
  } else {
    // Lost: score = 0.5 - (confidence * 0.5) → range [0.0, 0.5)
    return 0.5 - confidence * 0.5;
  }
}

export async function refineAgent(
  input: RefineInput,
  fightUrl: string,
  authHeaders: Record<string, string>
): Promise<RefineResult> {
  const admin = createAdminClient();
  const maxIterations = input.max_iterations ?? 10;
  const targetScore = input.target_score ?? 0.9;
  const level = input.opponent_level ?? 1;

  // Load the agent
  const { data: agent, error } = await admin
    .from("agents")
    .select("id, slug, name, system_prompt, model_id, capability_schema, architect_version, architect_history")
    .eq("slug", input.agent_slug)
    .eq("status", "active")
    .single();

  if (error || !agent) {
    throw new Error(`Agent '${input.agent_slug}' not found or inactive`);
  }

  if (!agent.system_prompt) {
    throw new Error(`Agent '${input.agent_slug}' has no system prompt — cannot refine`);
  }

  // Determine capability
  const capabilities = (agent.capability_schema as Array<{ name: string }>) ?? [];
  const capability = input.capability ?? capabilities[0]?.name;
  if (!capability) {
    throw new Error(`Agent '${input.agent_slug}' has no capabilities to refine`);
  }

  let currentPrompt = agent.system_prompt as string;
  let currentVersion = (agent.architect_version as number) ?? 1;
  const history = ((agent.architect_history as IterationRecord[]) ?? []).slice();
  const scores: (number | null)[] = [];
  let bestVersion = currentVersion;
  let bestScore: number | null = null;
  let consecutiveNoImprovement = 0;
  let consecutiveDrops = 0;
  let stoppedReason = "max_iterations";
  let iterationsRun = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterationsRun = iter + 1;
    console.log(`[architect-refine] Iteration ${iterationsRun}/${maxIterations} for ${input.agent_slug}`);

    // 1. Fire match
    const match = await fireMatch(fightUrl, authHeaders, input.agent_slug, capability, level);

    if (!match || match.status === "failed") {
      // Match failed — if we've made changes, rollback to best version
      if (iter > 0 && bestVersion !== currentVersion) {
        await rollbackToVersion(admin, agent.id as string, history, bestVersion);
      }
      stoppedReason = "match_error";
      scores.push(null);
      history.push({
        version: currentVersion,
        system_prompt: currentPrompt,
        match_id: match?.match_id ?? null,
        score: null,
        confidence: null,
        winner: null,
        reasoning: "Match failed",
        breakdown: null,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    // 2. Extract score
    // Agent is always side "a" since we put it there in fireMatch
    const score = extractScore(match, "a");
    scores.push(score);

    // Track best
    if (score !== null && (bestScore === null || score > bestScore)) {
      bestScore = score;
      bestVersion = currentVersion;
      consecutiveNoImprovement = 0;
    } else {
      consecutiveNoImprovement++;
    }

    // Track consecutive drops
    if (scores.length >= 2) {
      const prev = scores[scores.length - 2];
      if (prev !== null && score !== null && score < prev) {
        consecutiveDrops++;
      } else {
        consecutiveDrops = 0;
      }
    }

    // Log this iteration
    const record: IterationRecord = {
      version: currentVersion,
      system_prompt: currentPrompt,
      match_id: match.match_id,
      score,
      confidence: match.judgment?.confidence ?? null,
      winner: match.judgment?.winner ?? null,
      reasoning: match.judgment?.reasoning ?? null,
      breakdown: null,
      timestamp: new Date().toISOString(),
    };
    history.push(record);

    // 3. Check stopping conditions
    if (score !== null && score >= targetScore) {
      stoppedReason = "target_reached";
      console.log(`[architect-refine] Target score ${targetScore} reached (${score})`);
      await updateAgentHistory(admin, agent.id as string, currentPrompt, currentVersion, history);
      break;
    }

    if (consecutiveNoImprovement >= 3) {
      stoppedReason = "plateau";
      console.log(`[architect-refine] Plateau detected (${consecutiveNoImprovement} iterations no improvement)`);
      if (bestVersion !== currentVersion) {
        await rollbackToVersion(admin, agent.id as string, history, bestVersion);
        currentVersion = bestVersion;
      }
      break;
    }

    if (consecutiveDrops >= 2) {
      stoppedReason = "regression";
      console.log(`[architect-refine] Regression detected (${consecutiveDrops} consecutive drops)`);
      await rollbackToVersion(admin, agent.id as string, history, bestVersion);
      currentVersion = bestVersion;
      break;
    }

    // Don't rewrite after the last iteration
    if (iter === maxIterations - 1) {
      await updateAgentHistory(admin, agent.id as string, currentPrompt, currentVersion, history);
      break;
    }

    // 4. Rewrite prompt based on feedback
    if (match.judgment) {
      console.log(`[architect-refine] Rewriting prompt based on judgment...`);
      const newPrompt = await rewritePrompt(currentPrompt, capability, match.judgment, "a");
      currentVersion++;
      currentPrompt = newPrompt;

      // 5. Update agent in DB
      await admin
        .from("agents")
        .update({
          system_prompt: newPrompt,
          architect_version: currentVersion,
          architect_history: history,
        })
        .eq("id", agent.id);

      console.log(`[architect-refine] Updated to v${currentVersion}`);
    }
  }

  // Final history update
  await updateAgentHistory(admin, agent.id as string, currentPrompt, currentVersion, history);

  return {
    agent_slug: input.agent_slug,
    iterations_run: iterationsRun,
    score_progression: scores,
    best_version: bestVersion,
    current_version: currentVersion,
    stopped_reason: stoppedReason,
    history,
  };
}

async function updateAgentHistory(
  admin: ReturnType<typeof createAdminClient>,
  agentId: string,
  currentPrompt: string,
  currentVersion: number,
  history: IterationRecord[]
): Promise<void> {
  await admin
    .from("agents")
    .update({
      system_prompt: currentPrompt,
      architect_version: currentVersion,
      architect_history: history,
    })
    .eq("id", agentId);
}

async function rollbackToVersion(
  admin: ReturnType<typeof createAdminClient>,
  agentId: string,
  history: IterationRecord[],
  targetVersion: number
): Promise<void> {
  const targetRecord = history.find((h) => h.version === targetVersion);
  if (!targetRecord) {
    console.error(`[architect-refine] Cannot rollback — version ${targetVersion} not found in history`);
    return;
  }

  console.log(`[architect-refine] Rolling back to v${targetVersion}`);
  await admin
    .from("agents")
    .update({
      system_prompt: targetRecord.system_prompt,
      architect_version: targetVersion,
      architect_history: history,
    })
    .eq("id", agentId);
}
