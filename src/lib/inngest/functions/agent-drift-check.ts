// Agent Drift Check — runs every 6 hours.
// Compares recent 7-day performance window against prior 7-day window.
// Flags drift when metrics drop >15%. Updates agent health status.

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";

const DRIFT_THRESHOLD = 0.15; // 15% drop triggers warning
const CRITICAL_THRESHOLD = 0.25; // 25% drop triggers critical
const MIN_MATCHES = 5; // minimum matches per window to evaluate

interface WindowMetrics {
  winRate: number;
  avgScore: number;
  avgLatencyMs: number;
  avgCostEfficiency: number;
  criteriaScores: Record<string, number>;
  matchCount: number;
}

function computeWindowMetrics(
  matches: Record<string, unknown>[],
  agentId: string
): WindowMetrics {
  if (matches.length === 0) {
    return {
      winRate: 0, avgScore: 0, avgLatencyMs: 0,
      avgCostEfficiency: 0, criteriaScores: {}, matchCount: 0,
    };
  }

  let wins = 0;
  let totalScore = 0;
  let totalLatency = 0;
  let totalCostEff = 0;
  const criteriaAccum: Record<string, { sum: number; count: number }> = {};

  for (const m of matches) {
    const isA = m.agent_a_id === agentId;
    const side = isA ? "a" : "b";

    // Win rate
    if (m.winner === side) wins++;
    else if (m.winner === "tie") wins += 0.5;

    // Total score from judgment
    const breakdown = m.judgment_breakdown as Record<string, unknown> | null;
    if (breakdown) {
      const score = breakdown[`total_${side}`] as number;
      if (score != null) totalScore += score;

      const costEff = breakdown[`cost_efficiency_${side}`] as number;
      if (costEff != null) totalCostEff += costEff;

      // Per-criteria scores
      const criteria = breakdown[`criteria_scores_${side}`] as Array<{ name: string; score: number }> | null;
      if (criteria) {
        for (const c of criteria) {
          if (!criteriaAccum[c.name]) criteriaAccum[c.name] = { sum: 0, count: 0 };
          criteriaAccum[c.name].sum += c.score;
          criteriaAccum[c.name].count++;
        }
      }
    }

    // Latency
    const latency = (isA ? m.duration_a_ms : m.duration_b_ms) as number;
    if (latency != null) totalLatency += latency;
  }

  const n = matches.length;
  const criteriaScores: Record<string, number> = {};
  for (const [name, acc] of Object.entries(criteriaAccum)) {
    criteriaScores[name] = acc.count > 0 ? acc.sum / acc.count : 0;
  }

  return {
    winRate: wins / n,
    avgScore: totalScore / n,
    avgLatencyMs: totalLatency / n,
    avgCostEfficiency: totalCostEff / n,
    criteriaScores,
    matchCount: n,
  };
}

function detectDrifts(
  recent: WindowMetrics,
  prior: WindowMetrics
): Array<{ metric: string; drop: number; severity: "warning" | "critical" }> {
  const drifts: Array<{ metric: string; drop: number; severity: "warning" | "critical" }> = [];

  const checks: Array<{ name: string; recentVal: number; priorVal: number; higherIsBetter: boolean }> = [
    { name: "win_rate", recentVal: recent.winRate, priorVal: prior.winRate, higherIsBetter: true },
    { name: "avg_score", recentVal: recent.avgScore, priorVal: prior.avgScore, higherIsBetter: true },
    { name: "cost_efficiency", recentVal: recent.avgCostEfficiency, priorVal: prior.avgCostEfficiency, higherIsBetter: true },
  ];

  // Add criteria-level checks
  for (const [name, priorScore] of Object.entries(prior.criteriaScores)) {
    const recentScore = recent.criteriaScores[name];
    if (recentScore != null && priorScore > 0) {
      checks.push({ name: `criteria_${name}`, recentVal: recentScore, priorVal: priorScore, higherIsBetter: true });
    }
  }

  // Latency — lower is better
  if (prior.avgLatencyMs > 0 && recent.avgLatencyMs > 0) {
    const latencyIncrease = (recent.avgLatencyMs - prior.avgLatencyMs) / prior.avgLatencyMs;
    if (latencyIncrease > DRIFT_THRESHOLD) {
      drifts.push({
        metric: "latency",
        drop: latencyIncrease,
        severity: latencyIncrease > CRITICAL_THRESHOLD ? "critical" : "warning",
      });
    }
  }

  for (const check of checks) {
    if (check.priorVal <= 0) continue;
    const drop = (check.priorVal - check.recentVal) / check.priorVal;
    if (drop > DRIFT_THRESHOLD) {
      drifts.push({
        metric: check.name,
        drop,
        severity: drop > CRITICAL_THRESHOLD ? "critical" : "warning",
      });
    }
  }

  return drifts;
}

export const agentDriftCheck = inngest.createFunction(
  { id: "agent-drift-check", name: "Agent Drift Check" },
  { cron: "0 */6 * * *" }, // every 6 hours
  async ({ step }) => {
    const admin = createAdminClient();

    // ── 1. Get agents with enough match history ──
    const agents = await step.run("fetch-active-agents", async () => {
      const { data } = await admin
        .from("agents")
        .select("id, slug, name, model_id")
        .eq("status", "active")
        .gte("total_external_calls", 0);
      return data ?? [];
    });

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    let checked = 0;
    let driftsFound = 0;
    let recoveries = 0;

    // ── 2. Check each agent ──
    for (const agent of agents) {
      const agentId = agent.id as string;

      const matches = await step.run(`check-${agent.slug}`, async () => {
        // Fetch 14 days of matches
        const { data } = await admin
          .from("arena_matches")
          .select("agent_a_id, agent_b_id, winner, judgment_breakdown, duration_a_ms, duration_b_ms, api_cost_a, api_cost_b, completed_at")
          .eq("status", "completed")
          .or(`agent_a_id.eq.${agentId},agent_b_id.eq.${agentId}`)
          .gte("completed_at", fourteenDaysAgo.toISOString())
          .order("completed_at", { ascending: true });

        return data ?? [];
      });

      // Split into two 7-day windows
      const recentMatches = matches.filter(
        (m) => new Date(m.completed_at as string) >= sevenDaysAgo
      );
      const priorMatches = matches.filter(
        (m) => new Date(m.completed_at as string) < sevenDaysAgo
      );

      // Need minimum matches in both windows
      if (recentMatches.length < MIN_MATCHES || priorMatches.length < MIN_MATCHES) {
        // Not enough data — mark as unknown and skip
        await admin
          .from("agents")
          .update({ health_status: "unknown", health_checked_at: now.toISOString() })
          .eq("id", agentId);
        continue;
      }

      checked++;

      const recent = computeWindowMetrics(recentMatches, agentId);
      const prior = computeWindowMetrics(priorMatches, agentId);
      const drifts = detectDrifts(recent, prior);

      if (drifts.length > 0) {
        driftsFound++;
        const worstSeverity = drifts.some((d) => d.severity === "critical") ? "critical" : "warning";
        const healthStatus = worstSeverity === "critical" ? "degrading" : "warning";

        // Compute health score: 1.0 = perfect, drops based on drift severity
        const avgDrop = drifts.reduce((sum, d) => sum + d.drop, 0) / drifts.length;
        const healthScore = Math.max(0, Math.round((1 - avgDrop) * 100) / 100);

        // Insert health event
        await step.run(`alert-${agent.slug}`, async () => {
          await admin.from("agent_health_events").insert({
            agent_id: agentId,
            event_type: "drift_detected",
            severity: worstSeverity,
            message: `Performance drift detected: ${drifts.map((d) => `${d.metric} dropped ${Math.round(d.drop * 100)}%`).join(", ")}`,
            metrics_snapshot: {
              recent,
              prior,
              drifts,
              model_id: agent.model_id,
            },
          });

          // Update agent health status
          await admin
            .from("agents")
            .update({
              health_status: healthStatus,
              health_score: healthScore,
              health_checked_at: now.toISOString(),
            })
            .eq("id", agentId);
        });
      } else {
        // Check if recovering from a previous drift
        const { data: prevEvent } = await admin
          .from("agent_health_events")
          .select("id, event_type")
          .eq("agent_id", agentId)
          .is("resolved_at", null)
          .eq("event_type", "drift_detected")
          .order("detected_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (prevEvent) {
          recoveries++;
          await step.run(`recover-${agent.slug}`, async () => {
            // Mark previous drift as resolved
            await admin
              .from("agent_health_events")
              .update({ resolved_at: now.toISOString() })
              .eq("id", prevEvent.id);

            // Log recovery event
            await admin.from("agent_health_events").insert({
              agent_id: agentId,
              event_type: "recovery",
              severity: "info",
              message: "Performance recovered to baseline levels",
              metrics_snapshot: { recent, prior },
            });
          });
        }

        // Healthy
        const healthScore = Math.min(1, Math.round(recent.winRate * 100) / 100);
        await admin
          .from("agents")
          .update({
            health_status: "healthy",
            health_score: healthScore,
            health_checked_at: now.toISOString(),
          })
          .eq("id", agentId);
      }
    }

    return { checked, driftsFound, recoveries, totalAgents: agents.length };
  }
);
