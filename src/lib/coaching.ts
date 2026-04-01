// Agent Performance Coach — generates per-match improvement tips.
// Coaches against the agent's OWN baseline, never the opponent's.
// Only flags criteria where the agent underperformed vs its historical average.

import { createAdminClient } from "@/lib/supabase/admin";

interface CriterionScore {
  name: string;
  score: number;
  weight: number;
}

interface CoachingTip {
  category: string;
  tip: string;
  metric_name: string;
  current_value: number;
  baseline_value: number;
}

const CRITERIA_TIPS: Record<string, (current: number, baseline: number) => string> = {
  accuracy: (cur, base) =>
    `Accuracy dropped to ${(cur * 100).toFixed(0)}% (your baseline: ${(base * 100).toFixed(0)}%). Check if your system prompt has explicit instructions for data precision and quantified claims.`,
  coherence: (cur, base) =>
    `Coherence scored ${(cur * 100).toFixed(0)}% vs your usual ${(base * 100).toFixed(0)}%. Your response structure may be inconsistent — ensure your output follows a predictable pattern.`,
  conciseness: (cur, base) =>
    `Conciseness at ${(cur * 100).toFixed(0)}% (baseline: ${(base * 100).toFixed(0)}%). Your output may be verbose — trim redundant explanations and lead with key findings.`,
  relevance: (cur, base) =>
    `Relevance scored ${(cur * 100).toFixed(0)}% vs ${(base * 100).toFixed(0)}% baseline. Some of your output may not directly address the input — tighten the connection between input data and analysis.`,
  completeness: (cur, base) =>
    `Completeness at ${(cur * 100).toFixed(0)}% (baseline: ${(base * 100).toFixed(0)}%). You may be missing aspects of the input — check if all data points are addressed in your response.`,
  correctness: (cur, base) =>
    `Correctness dropped to ${(cur * 100).toFixed(0)}% from ${(base * 100).toFixed(0)}%. Review your logic paths and error handling for edge cases.`,
  quality: (cur, base) =>
    `Output quality at ${(cur * 100).toFixed(0)}% vs ${(base * 100).toFixed(0)}% baseline. Consider enriching your response with more specific, actionable insights.`,
  prompt_adherence: (cur, base) =>
    `Prompt adherence at ${(cur * 100).toFixed(0)}% (baseline: ${(base * 100).toFixed(0)}%). Your response may be drifting from what was asked — ground your output in the specific input provided.`,
};

function generateSpeedTip(durationMs: number, baselineDurationMs: number): CoachingTip | null {
  if (baselineDurationMs <= 0 || durationMs <= baselineDurationMs * 1.2) return null;

  const increase = ((durationMs - baselineDurationMs) / baselineDurationMs * 100).toFixed(0);
  return {
    category: "speed",
    tip: `Response time was ${(durationMs / 1000).toFixed(1)}s — ${increase}% slower than your average ${(baselineDurationMs / 1000).toFixed(1)}s. If using chain-of-thought, consider whether all reasoning steps are necessary.`,
    metric_name: "duration_ms",
    current_value: durationMs,
    baseline_value: baselineDurationMs,
  };
}

function generateCostTip(costEfficiency: number, baselineCostEff: number): CoachingTip | null {
  if (baselineCostEff <= 0 || costEfficiency >= baselineCostEff * 0.85) return null;

  return {
    category: "cost",
    tip: `Cost efficiency dropped to ${(costEfficiency * 100).toFixed(0)}% from your baseline ${(baselineCostEff * 100).toFixed(0)}%. Your token usage may have increased — check if your output is more verbose than needed.`,
    metric_name: "cost_efficiency",
    current_value: costEfficiency,
    baseline_value: baselineCostEff,
  };
}

function generateSchemaTip(schemaCompliance: number): CoachingTip | null {
  if (schemaCompliance >= 1) return null;

  return {
    category: "schema",
    tip: "Schema compliance failed. Ensure your response is valid JSON matching the expected output structure. Common issues: trailing commas, unclosed brackets, markdown wrappers around JSON.",
    metric_name: "schema_compliance",
    current_value: schemaCompliance,
    baseline_value: 1,
  };
}

/**
 * Generate coaching tips for an agent after a match.
 * Compares match performance against the agent's own historical baseline.
 * Returns up to 3 tips, prioritized by largest gap from baseline.
 */
export async function generateCoachingTips(
  agentId: string,
  matchId: string,
  side: "a" | "b",
  judgmentBreakdown: Record<string, unknown>,
  durationMs: number
): Promise<CoachingTip[]> {
  const admin = createAdminClient();

  // Fetch agent's historical baseline from recent matches (last 30 days, up to 50 matches)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: history } = await admin
    .from("arena_matches")
    .select("judgment_breakdown, duration_a_ms, duration_b_ms, agent_a_id")
    .eq("status", "completed")
    .or(`agent_a_id.eq.${agentId},agent_b_id.eq.${agentId}`)
    .neq("id", matchId)
    .gte("completed_at", thirtyDaysAgo)
    .order("completed_at", { ascending: false })
    .limit(50);

  if (!history || history.length < 3) return []; // Not enough history for baseline

  // Compute baseline from history
  const baselineCriteria: Record<string, { sum: number; count: number }> = {};
  let baselineDurationSum = 0;
  let baselineDurationCount = 0;
  let baselineCostEffSum = 0;
  let baselineCostEffCount = 0;

  for (const m of history) {
    const isA = m.agent_a_id === agentId;
    const s = isA ? "a" : "b";
    const bd = m.judgment_breakdown as Record<string, unknown> | null;
    if (!bd) continue;

    const criteria = bd[`criteria_scores_${s}`] as CriterionScore[] | null;
    if (criteria) {
      for (const c of criteria) {
        if (!baselineCriteria[c.name]) baselineCriteria[c.name] = { sum: 0, count: 0 };
        baselineCriteria[c.name].sum += c.score;
        baselineCriteria[c.name].count++;
      }
    }

    const dur = (isA ? m.duration_a_ms : m.duration_b_ms) as number;
    if (dur != null) {
      baselineDurationSum += dur;
      baselineDurationCount++;
    }

    const costEff = bd[`cost_efficiency_${s}`] as number;
    if (costEff != null) {
      baselineCostEffSum += costEff;
      baselineCostEffCount++;
    }
  }

  const tips: CoachingTip[] = [];

  // ── Criteria tips ──
  const currentCriteria = judgmentBreakdown[`criteria_scores_${side}`] as CriterionScore[] | null;
  if (currentCriteria) {
    for (const c of currentCriteria) {
      const baseline = baselineCriteria[c.name];
      if (!baseline || baseline.count < 3) continue;

      const baselineAvg = baseline.sum / baseline.count;
      // Only tip if below own baseline by >10%
      if (c.score < baselineAvg * 0.9) {
        const tipGenerator = CRITERIA_TIPS[c.name];
        tips.push({
          category: c.name === "accuracy" || c.name === "correctness" ? "accuracy" : c.name === "coherence" || c.name === "quality" ? "coherence" : "general",
          tip: tipGenerator ? tipGenerator(c.score, baselineAvg) : `${c.name} scored ${(c.score * 100).toFixed(0)}% vs your baseline ${(baselineAvg * 100).toFixed(0)}%.`,
          metric_name: c.name,
          current_value: c.score,
          baseline_value: baselineAvg,
        });
      }
    }
  }

  // ── Speed tip ──
  const baselineDuration = baselineDurationCount > 0 ? baselineDurationSum / baselineDurationCount : 0;
  const speedTip = generateSpeedTip(durationMs, baselineDuration);
  if (speedTip) tips.push(speedTip);

  // ── Cost tip ──
  const currentCostEff = judgmentBreakdown[`cost_efficiency_${side}`] as number;
  const baselineCostEff = baselineCostEffCount > 0 ? baselineCostEffSum / baselineCostEffCount : 0;
  const costTip = generateCostTip(currentCostEff, baselineCostEff);
  if (costTip) tips.push(costTip);

  // ── Schema tip ──
  const schemaCompliance = judgmentBreakdown[`schema_compliance_${side}`] as number;
  const schemaTip = generateSchemaTip(schemaCompliance);
  if (schemaTip) tips.push(schemaTip);

  // Sort by largest gap from baseline, return top 3
  tips.sort((a, b) => {
    const gapA = a.baseline_value > 0 ? (a.baseline_value - a.current_value) / a.baseline_value : 0;
    const gapB = b.baseline_value > 0 ? (b.baseline_value - b.current_value) / b.baseline_value : 0;
    return gapB - gapA;
  });

  const topTips = tips.slice(0, 3);

  // Persist tips
  if (topTips.length > 0) {
    await admin.from("agent_coaching_tips").insert(
      topTips.map((t) => ({
        agent_id: agentId,
        match_id: matchId,
        category: t.category,
        tip: t.tip,
        metric_name: t.metric_name,
        current_value: t.current_value,
        baseline_value: t.baseline_value,
      }))
    );
  }

  return topTips;
}
