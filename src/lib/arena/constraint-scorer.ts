// Constraint Scorer — batched judging of agent outputs against constraint sets.
// One judge call per iteration scores ALL challenges at once.
// Scores on 4 axes: accuracy, speed, cost, reliability.

import Anthropic from "@anthropic-ai/sdk";

// ============================================================
// Types
// ============================================================

/** A single constraint that an agent output must satisfy */
export interface Constraint {
  /** What this constraint checks */
  name: string;
  /** "contains" | "not_contains" | "matches_regex" | "json_field" | "numeric_range" | "semantic" */
  type: "contains" | "not_contains" | "matches_regex" | "json_field" | "numeric_range" | "semantic";
  /** The expected value, regex pattern, field path, or range */
  value: string;
  /** Weight 0-1 for how important this constraint is */
  weight: number;
}

/** A challenge with its cheat sheet (constraint set) */
export interface ConstraintChallenge {
  /** Challenge prompt text */
  prompt: string;
  /** Title for display */
  title: string;
  /** The constraint set — what any correct answer must satisfy */
  constraints: Constraint[];
  /** Factor weights for this challenge */
  factor_weights: FactorWeights;
  /** Speed threshold in ms — "excellent" cutoff */
  speed_threshold_ms: number;
  /** Token budget — expected max tokens for a good response */
  token_budget: number;
}

/** User-defined optimization target on 4 axes (each 0-1, must sum to 1) */
export interface FactorWeights {
  accuracy: number;
  speed: number;
  cost: number;
  reliability: number;
}

/** Raw output collected from running an agent on a challenge */
export interface ChallengeRun {
  /** Index into the challenge set */
  challenge_index: number;
  /** The agent's raw output text */
  output: string;
  /** Response latency in ms */
  latency_ms: number;
  /** Total tokens used (input + output) */
  tokens_used: number;
}

/** Score result for a single challenge run */
export interface ChallengeScore {
  /** Per-constraint pass/fail + score */
  constraint_results: Array<{
    name: string;
    passed: boolean;
    score: number; // 0-1
    weight: number;
  }>;
  /** Aggregate accuracy: weighted sum of constraint scores */
  accuracy: number;
  /** Speed score 0-1 based on threshold */
  speed: number;
  /** Cost score 0-1 based on token budget */
  cost: number;
  /** Raw latency in ms */
  latency_ms: number;
  /** Raw token count */
  tokens_used: number;
}

/** Aggregate scores across all challenges in an iteration */
export interface IterationScores {
  /** Average accuracy across all challenges */
  accuracy: number;
  /** Average speed score */
  speed: number;
  /** Average cost score */
  cost: number;
  /** Reliability = 1 - coefficient of variation of accuracy scores */
  reliability: number;
  /** Weighted composite using the user's factor weights */
  composite: number;
  /** Per-challenge breakdown */
  challenges: ChallengeScore[];
  /** Which constraints failed most often (for weakness analysis) */
  worst_constraints: Array<{ name: string; fail_rate: number; avg_score: number }>;
}

// ============================================================
// Batched Judge — ONE call scores ALL challenge outputs
// ============================================================

/**
 * Score all agent outputs in a single batched Haiku call.
 * The judge gets the full picture: all challenges, all outputs, all cheat sheets.
 * Returns per-challenge, per-constraint scores.
 *
 * Deterministic checks (contains, regex, json_field, numeric_range) are still
 * done locally — only semantic/qualitative constraints go to the judge.
 * But the judge sees everything so it can spot patterns across challenges.
 */
export async function batchScoreOutputs(
  challenges: ConstraintChallenge[],
  runs: ChallengeRun[],
): Promise<ChallengeScore[]> {
  // First pass: score all deterministic constraints locally
  const partialScores: Array<{
    run: ChallengeRun;
    challenge: ConstraintChallenge;
    localResults: Map<string, number>; // constraint name → score (for deterministic ones)
    needsJudge: Constraint[]; // semantic constraints that need the LLM
  }> = [];

  for (const run of runs) {
    const challenge = challenges[run.challenge_index];
    if (!challenge) continue;

    const localResults = new Map<string, number>();
    const needsJudge: Constraint[] = [];

    for (const constraint of challenge.constraints) {
      if (constraint.type === "semantic") {
        needsJudge.push(constraint);
      } else {
        const score = checkConstraintLocal(run.output, constraint);
        localResults.set(constraint.name, score);
      }
    }

    partialScores.push({ run, challenge, localResults, needsJudge });
  }

  // Collect all semantic constraints that need judging
  const hasSemanticConstraints = partialScores.some((p) => p.needsJudge.length > 0);

  // If there are semantic constraints, make ONE batched judge call
  let judgeResults: Map<string, Map<string, number>> = new Map(); // challengeIndex → constraintName → score

  if (hasSemanticConstraints) {
    judgeResults = await batchJudgeCall(challenges, partialScores);
  }

  // Assemble final scores
  return partialScores.map(({ run, challenge, localResults, needsJudge }) => {
    const constraint_results = challenge.constraints.map((c) => {
      let score: number;
      if (c.type === "semantic") {
        score = judgeResults.get(String(run.challenge_index))?.get(c.name) ?? 0.5;
      } else {
        score = localResults.get(c.name) ?? 0;
      }
      return {
        name: c.name,
        passed: score >= 0.5,
        score,
        weight: c.weight,
      };
    });

    // Weighted accuracy
    const totalWeight = constraint_results.reduce((s, r) => s + r.weight, 0);
    const accuracy = totalWeight > 0
      ? constraint_results.reduce((s, r) => s + r.score * r.weight, 0) / totalWeight
      : 0;

    // Speed score: 1.0 if under threshold, linear decay to 0 at 5x threshold
    const speedRatio = run.latency_ms / challenge.speed_threshold_ms;
    const speed = speedRatio <= 1 ? 1.0 : Math.max(0, 1 - (speedRatio - 1) / 4);

    // Cost score: 1.0 if under budget, linear decay to 0 at 3x budget
    const costRatio = run.tokens_used / challenge.token_budget;
    const cost = costRatio <= 1 ? 1.0 : Math.max(0, 1 - (costRatio - 1) / 2);

    return {
      constraint_results,
      accuracy,
      speed,
      cost,
      latency_ms: run.latency_ms,
      tokens_used: run.tokens_used,
    };
  });
}

/**
 * Single batched Haiku call that scores all semantic constraints across all challenges.
 * The judge sees every challenge + output + cheat sheet in one prompt.
 */
async function batchJudgeCall(
  challenges: ConstraintChallenge[],
  partials: Array<{
    run: ChallengeRun;
    challenge: ConstraintChallenge;
    needsJudge: Constraint[];
  }>,
): Promise<Map<string, Map<string, number>>> {
  // Build the batch prompt
  const entries = partials
    .filter((p) => p.needsJudge.length > 0)
    .map((p) => {
      const constraintList = p.needsJudge
        .map((c) => `  - "${c.name}": ${c.value}`)
        .join("\n");

      return `--- Challenge #${p.run.challenge_index}: "${p.challenge.title}" ---
TASK: ${p.challenge.prompt.slice(0, 300)}

AGENT OUTPUT (first 800 chars):
${p.run.output.slice(0, 800)}

SCORE THESE CONSTRAINTS (0.0 to 1.0 each):
${constraintList}`;
    });

  if (entries.length === 0) return new Map();

  const anthropic = new Anthropic();

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: `You are a precise evaluator scoring AI agent outputs against quality constraints.
Score each constraint from 0.0 (completely fails) to 1.0 (perfectly satisfies).
Be fair but rigorous. A score of 0.7+ means the constraint is mostly satisfied.

${entries.join("\n\n")}

Return ONLY valid JSON — an object mapping challenge index to constraint scores:
{
  "0": { "constraint_name": 0.8, "other_constraint": 0.6 },
  "3": { "constraint_name": 0.9 }
}`,
      }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "{}";
    let jsonStr = text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:\w+)?\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(jsonStr) as Record<string, Record<string, number>>;

    const result = new Map<string, Map<string, number>>();
    for (const [idx, scores] of Object.entries(parsed)) {
      const constraintMap = new Map<string, number>();
      for (const [name, score] of Object.entries(scores)) {
        constraintMap.set(name, Math.max(0, Math.min(1, score)));
      }
      result.set(idx, constraintMap);
    }
    return result;
  } catch (err) {
    console.error("[constraint-scorer] Batch judge call failed:", err);
    // Return neutral scores on failure
    const result = new Map<string, Map<string, number>>();
    for (const p of partials) {
      if (p.needsJudge.length > 0) {
        const constraintMap = new Map<string, number>();
        for (const c of p.needsJudge) {
          constraintMap.set(c.name, 0.5);
        }
        result.set(String(p.run.challenge_index), constraintMap);
      }
    }
    return result;
  }
}

// ============================================================
// Local Constraint Checks (deterministic — no LLM)
// ============================================================

function checkConstraintLocal(output: string, constraint: Constraint): number {
  const lower = output.toLowerCase();

  switch (constraint.type) {
    case "contains":
      return lower.includes(constraint.value.toLowerCase()) ? 1.0 : 0.0;

    case "not_contains":
      return !lower.includes(constraint.value.toLowerCase()) ? 1.0 : 0.0;

    case "matches_regex": {
      try {
        const regex = new RegExp(constraint.value, "i");
        return regex.test(output) ? 1.0 : 0.0;
      } catch {
        return 0.0;
      }
    }

    case "json_field": {
      try {
        const parsed = JSON.parse(output);
        const [path, expected] = constraint.value.split("=");
        const val = getNestedValue(parsed, path.trim());
        if (expected === undefined) return val !== undefined ? 1.0 : 0.0;
        return String(val).toLowerCase() === expected.trim().toLowerCase() ? 1.0 : 0.0;
      } catch {
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            const [path, expected] = constraint.value.split("=");
            const val = getNestedValue(parsed, path.trim());
            if (expected === undefined) return val !== undefined ? 1.0 : 0.0;
            return String(val).toLowerCase() === expected.trim().toLowerCase() ? 1.0 : 0.0;
          } catch {
            return 0.0;
          }
        }
        return 0.0;
      }
    }

    case "numeric_range": {
      const [minStr, maxStr] = constraint.value.split("-");
      const min = parseFloat(minStr);
      const max = parseFloat(maxStr);
      const numbers = output.match(/-?\d+\.?\d*/g);
      if (!numbers) return 0.0;
      return numbers.some((n) => {
        const v = parseFloat(n);
        return v >= min && v <= max;
      }) ? 1.0 : 0.0;
    }

    default:
      return 0.0;
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ============================================================
// Iteration Aggregation
// ============================================================

/**
 * Aggregate challenge scores into an iteration summary with reliability.
 */
export function aggregateScores(
  challengeScores: ChallengeScore[],
  factorWeights: FactorWeights,
): IterationScores {
  const n = challengeScores.length;
  if (n === 0) {
    return {
      accuracy: 0, speed: 0, cost: 0, reliability: 0, composite: 0,
      challenges: [], worst_constraints: [],
    };
  }

  const avgAccuracy = challengeScores.reduce((s, c) => s + c.accuracy, 0) / n;
  const avgSpeed = challengeScores.reduce((s, c) => s + c.speed, 0) / n;
  const avgCost = challengeScores.reduce((s, c) => s + c.cost, 0) / n;

  // Reliability = 1 - normalized standard deviation of accuracy scores
  const accuracies = challengeScores.map((c) => c.accuracy);
  const mean = avgAccuracy;
  const variance = accuracies.reduce((s, a) => s + (a - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? Math.min(stdDev / mean, 1) : 1;
  const reliability = 1 - cv;

  // Composite weighted by user's factor weights
  const composite =
    avgAccuracy * factorWeights.accuracy +
    avgSpeed * factorWeights.speed +
    avgCost * factorWeights.cost +
    reliability * factorWeights.reliability;

  // Find worst constraints across all challenges
  const constraintStats: Record<string, { fails: number; total: number; scoreSum: number }> = {};
  for (const cs of challengeScores) {
    for (const cr of cs.constraint_results) {
      if (!constraintStats[cr.name]) {
        constraintStats[cr.name] = { fails: 0, total: 0, scoreSum: 0 };
      }
      constraintStats[cr.name].total++;
      constraintStats[cr.name].scoreSum += cr.score;
      if (!cr.passed) constraintStats[cr.name].fails++;
    }
  }

  const worst_constraints = Object.entries(constraintStats)
    .map(([name, stats]) => ({
      name,
      fail_rate: stats.total > 0 ? stats.fails / stats.total : 0,
      avg_score: stats.total > 0 ? stats.scoreSum / stats.total : 0,
    }))
    .sort((a, b) => b.fail_rate - a.fail_rate || a.avg_score - b.avg_score)
    .slice(0, 5);

  return {
    accuracy: avgAccuracy,
    speed: avgSpeed,
    cost: avgCost,
    reliability,
    composite,
    challenges: challengeScores,
    worst_constraints,
  };
}

// ============================================================
// Challenge Set Generator (the expensive one-time step)
// ============================================================

/**
 * Generate a constraint-based challenge set for a domain + level.
 * Uses Sonnet for high-quality challenge + constraint generation.
 * This is the ONE expensive call — everything after is cheap.
 */
export async function generateConstraintChallenges(params: {
  agentName: string;
  agentDescription: string | null;
  capability: string;
  level: number;
  count: number;
  trainingGoal?: string;
  factorWeights?: FactorWeights;
}): Promise<ConstraintChallenge[]> {
  const { agentName, agentDescription, capability, level, count, trainingGoal, factorWeights } = params;

  const anthropic = new Anthropic();

  const weightContext = factorWeights
    ? `The user prioritizes: accuracy=${(factorWeights.accuracy * 100).toFixed(0)}%, speed=${(factorWeights.speed * 100).toFixed(0)}%, cost=${(factorWeights.cost * 100).toFixed(0)}%, reliability=${(factorWeights.reliability * 100).toFixed(0)}%. Weight constraints accordingly.`
    : "";

  const goalContext = trainingGoal
    ? `Training goal: "${trainingGoal}". Design challenges that specifically test this goal.`
    : "";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: `You are a challenge designer for an AI agent evaluation platform. Generate ${count} challenges with constraint-based scoring.

AGENT: ${agentName}
DESCRIPTION: ${agentDescription ?? "General purpose agent"}
CAPABILITY: ${capability}
DIFFICULTY LEVEL: ${level}/4 (1=basic, 2=intermediate, 3=advanced, 4=expert)
${goalContext}
${weightContext}

For each challenge, produce:
1. A specific, concrete task prompt
2. A constraint set (the "cheat sheet") — NOT a single right answer, but conditions any valid response must satisfy
3. A speed threshold in ms (how fast a good agent should complete this)
4. A token budget (expected max tokens for a good response)

Constraint types you can use:
- "contains": output must contain this string (case-insensitive)
- "not_contains": output must NOT contain this string
- "matches_regex": output must match this regex pattern
- "json_field": check a JSON field exists or equals a value (format: "path.to.field=value" or "path.to.field exists")
- "numeric_range": output must contain a number in this range (format: "min-max")
- "semantic": qualitative check — a natural language requirement (e.g., "analysis addresses counterarguments", "response is well-structured with clear sections"). Use this for qualities that can't be checked mechanically.

Mix deterministic and semantic constraints. Deterministic for verifiable facts, format, structure. Semantic for quality, depth, coherence. A good challenge has both.

Each constraint has a weight (0-1). Weights within a challenge should sum to approximately 1.0.

Return ONLY valid JSON array:
[
  {
    "title": "short descriptive title",
    "prompt": "the full task prompt for the agent",
    "constraints": [
      { "name": "human-readable name", "type": "contains|not_contains|matches_regex|json_field|numeric_range|semantic", "value": "the check value", "weight": 0.3 }
    ],
    "speed_threshold_ms": 5000,
    "token_budget": 500
  }
]`,
    }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "[]";

  let jsonStr = text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:\w+)?\s*/, "").replace(/\s*```$/, "");
  }

  try {
    const parsed = JSON.parse(jsonStr) as Array<{
      title: string;
      prompt: string;
      constraints: Constraint[];
      speed_threshold_ms: number;
      token_budget: number;
    }>;

    return parsed.map((c) => ({
      title: c.title,
      prompt: c.prompt,
      constraints: c.constraints,
      factor_weights: factorWeights ?? { accuracy: 0.4, speed: 0.2, cost: 0.2, reliability: 0.2 },
      speed_threshold_ms: c.speed_threshold_ms,
      token_budget: c.token_budget,
    }));
  } catch {
    console.error("[constraint-scorer] Failed to parse generated challenges");
    return [];
  }
}
