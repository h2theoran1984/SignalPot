// AutoTune — automated prompt optimization using arena judgment feedback.
// Analyzes weaknesses from match breakdowns and proposes improved prompts.

import Anthropic from "@anthropic-ai/sdk";
import type { JudgmentBreakdown, CriterionScore, ArenaRubric } from "./types";
import { inferRubric } from "./rubric";
import { PROCESSOR_REGISTRY } from "./processors";

const anthropic = new Anthropic();

export interface WeaknessReport {
  /** Criteria that scored lowest on average across all rounds */
  weakest_criteria: Array<{ name: string; avg_score: number; weight: number }>;
  /** Win rate in the batch */
  win_rate: number;
  /** Average total score for the agent */
  avg_total_score: number;
  /** Rounds where the agent lost — their judgment reasoning */
  loss_reasons: string[];
  /** Overall summary */
  summary: string;
}

/**
 * Analyze match results to identify the agent's weaknesses.
 * Agent is always side "a" (the grind endpoint puts the target agent as agent_a).
 */
export function analyzeWeaknesses(params: {
  breakdowns: JudgmentBreakdown[];
  reasonings: string[];
  winners: Array<"a" | "b" | "tie">;
}): WeaknessReport {
  const { breakdowns, reasonings, winners } = params;

  const wins = winners.filter((w) => w === "a").length;
  const total = winners.length;
  const win_rate = total > 0 ? wins / total : 0;

  // Average criteria scores for agent (side a) across all breakdowns
  const criteriaAccum: Record<string, { total: number; count: number; weight: number }> = {};

  let totalScoreSum = 0;
  let totalScoreCount = 0;

  for (const bd of breakdowns) {
    totalScoreSum += bd.total_a;
    totalScoreCount++;

    for (const cs of bd.criteria_scores_a) {
      if (!criteriaAccum[cs.name]) {
        criteriaAccum[cs.name] = { total: 0, count: 0, weight: cs.weight };
      }
      criteriaAccum[cs.name].total += cs.score;
      criteriaAccum[cs.name].count++;
    }
  }

  // Sort criteria by average score (lowest first)
  const weakest_criteria = Object.entries(criteriaAccum)
    .map(([name, { total, count, weight }]) => ({
      name,
      avg_score: count > 0 ? total / count : 0,
      weight,
    }))
    .sort((a, b) => a.avg_score - b.avg_score);

  // Collect loss reasons
  const loss_reasons: string[] = [];
  for (let i = 0; i < winners.length; i++) {
    if (winners[i] === "b" && reasonings[i]) {
      loss_reasons.push(reasonings[i]);
    }
  }

  const avg_total_score = totalScoreCount > 0 ? totalScoreSum / totalScoreCount : 0;

  const summary = `Win rate: ${(win_rate * 100).toFixed(0)}% (${wins}/${total}). ` +
    `Avg score: ${avg_total_score.toFixed(3)}. ` +
    `Weakest: ${weakest_criteria.slice(0, 2).map((c) => `${c.name} (${c.avg_score.toFixed(2)})`).join(", ")}. ` +
    `Losses: ${loss_reasons.length}.`;

  return { weakest_criteria, win_rate, avg_total_score, loss_reasons, summary };
}

/**
 * Use Claude Sonnet to propose an improved system prompt based on weakness analysis.
 * Returns just the new prompt text.
 */
export async function proposeImprovedPrompt(params: {
  currentPrompt: string;
  capability: string;
  weaknessReport: WeaknessReport;
}): Promise<string> {
  const { currentPrompt, capability, weaknessReport } = params;
  const rubric = inferRubric(capability);

  const rubricDescription = rubric.criteria
    .map((c) => `- ${c.name} (${(c.weight * 100).toFixed(0)}%): ${c.description}`)
    .join("\n");

  const weaknessDetails = weaknessReport.weakest_criteria
    .map((c) => `- ${c.name}: avg ${c.avg_score.toFixed(2)} / 1.0 (weight: ${(c.weight * 100).toFixed(0)}%)`)
    .join("\n");

  const lossDetails = weaknessReport.loss_reasons.length > 0
    ? weaknessReport.loss_reasons.map((r, i) => `Loss ${i + 1}: ${r}`).join("\n")
    : "No losses recorded.";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `You are an expert AI prompt engineer specializing in optimizing system prompts for arena competition.

Your task: Given a current system prompt and its arena performance data, propose a targeted improvement.

Rules:
- Keep the same JSON output schema — only modify the instructional text
- Focus on the weakest scoring criteria
- Be specific — don't add generic "be better" instructions
- Keep the prompt concise — brevity matters for cost efficiency
- Preserve any formatting constraints (JSON-only output, etc.)
- Return ONLY the new system prompt text, nothing else — no explanation, no markdown fences`,

    messages: [
      {
        role: "user",
        content: `## Current System Prompt
${currentPrompt}

## Capability
${capability}

## Arena Rubric Criteria
${rubricDescription}

## Performance Summary
${weaknessReport.summary}

## Criteria Scores (agent average)
${weaknessDetails}

## Loss Analysis
${lossDetails}

Based on this analysis, propose an improved system prompt that addresses the identified weaknesses while maintaining the output schema. Return ONLY the new prompt text.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from prompt engineer");
  }

  // Strip any accidental markdown fencing
  let text = content.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:\w+)?\s*/, "").replace(/\s*```$/, "");
  }

  return text;
}

/**
 * Detect which processors from the registry could help with the observed weaknesses.
 * Matches loss patterns against each processor's detection_patterns.
 * Returns processor IDs that should be activated.
 */
export function detectApplicableProcessors(
  weaknessReport: WeaknessReport,
  capability: string,
  alreadyActive: string[],
): string[] {
  // Extract the verb from capability (e.g., "signalpot/meeting-summary@v1" → "meeting-summary")
  let verb = capability;
  if (verb.includes("/")) {
    verb = verb.split("/").pop()?.split("@")[0] ?? verb;
  }

  const recommended: string[] = [];

  for (const proc of PROCESSOR_REGISTRY) {
    // Skip if already active
    if (alreadyActive.includes(proc.id)) continue;

    // Skip if capability doesn't match
    if (!proc.applicable_capabilities.some((c) => verb.includes(c) || c.includes(verb))) continue;

    const { criteria_names, loss_keywords, min_loss_rate } = proc.detection_patterns;

    // Check loss rate threshold
    if (weaknessReport.win_rate > (1 - min_loss_rate)) continue;

    // Check if weakest criteria match
    const criteriaMatch = weaknessReport.weakest_criteria
      .slice(0, 3)
      .some((c) => criteria_names.includes(c.name));

    // Check if loss reasons contain keywords
    const keywordMatch = weaknessReport.loss_reasons.some((reason) =>
      loss_keywords.some((kw) => reason.toLowerCase().includes(kw.toLowerCase()))
    );

    if (criteriaMatch && keywordMatch) {
      recommended.push(proc.id);
    }
  }

  return recommended;
}

/**
 * Generate a simple diff-like summary between two prompts.
 */
export function promptDiff(oldPrompt: string, newPrompt: string): string {
  const oldLines = oldPrompt.split("\n");
  const newLines = newPrompt.split("\n");

  const lines: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] ?? "";
    const newLine = newLines[i] ?? "";

    if (oldLine !== newLine) {
      if (oldLine) lines.push(`- ${oldLine}`);
      if (newLine) lines.push(`+ ${newLine}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : "(no changes)";
}
