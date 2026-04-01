// Telemetry Rollup — processes unrolled agent_telemetry rows every 5 minutes.
// Updates: agent stats, trust signals, reliability snapshots, and rollback guardrail checks.

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeReliabilityScore,
  healthToComponent,
} from "@/lib/reliability";
import { processRollbackForAgent } from "@/lib/arena/rollback-guardrail";

const BATCH_SIZE = 500;

interface AgentAgg {
  totalCalls: number;
  successfulCalls: number;
  totalDurationMs: number;
  durationCount: number;
  totalApiCost: number;
  totalCost: number;
}

export const telemetryRollup = inngest.createFunction(
  { id: "telemetry-rollup", name: "Telemetry Rollup" },
  { cron: "*/5 * * * *" }, // every 5 minutes
  async ({ step }) => {
    const admin = createAdminClient();

    // ── 1. Fetch unprocessed rows ───────────────────────────────────
    const rows = await step.run("fetch-pending", async () => {
      const { data, error } = await admin
        .from("agent_telemetry")
        .select("id, agent_id, event, duration_ms, api_cost, cost, success")
        .eq("rolled_up", false)
        .order("created_at", { ascending: true })
        .limit(BATCH_SIZE);

      if (error) throw new Error(`Fetch failed: ${error.message}`);
      return data ?? [];
    });

    if (rows.length === 0) {
      return { processed: 0 };
    }

    // ── 2. Aggregate per agent ──────────────────────────────────────
    const agentAggs = new Map<string, AgentAgg>();

    for (const row of rows) {
      if (row.event !== "call_completed" && row.event !== "call_failed") continue;

      const agentId = row.agent_id as string;
      let agg = agentAggs.get(agentId);
      if (!agg) {
        agg = {
          totalCalls: 0,
          successfulCalls: 0,
          totalDurationMs: 0,
          durationCount: 0,
          totalApiCost: 0,
          totalCost: 0,
        };
        agentAggs.set(agentId, agg);
      }

      agg.totalCalls++;
      if (row.success) agg.successfulCalls++;
      if (row.duration_ms != null) {
        agg.totalDurationMs += row.duration_ms as number;
        agg.durationCount++;
      }
      agg.totalApiCost += (row.api_cost as number) ?? 0;
      agg.totalCost += (row.cost as number) ?? 0;
    }

    // ── 3. Update agent stats ───────────────────────────────────────
    await step.run("update-agent-stats", async () => {
      for (const [agentId, agg] of agentAggs) {
        const { data: agent } = await admin
          .from("agents")
          .select("total_external_calls, avg_latency_ms")
          .eq("id", agentId)
          .single();

        if (!agent) continue;

        const prevCalls = (agent.total_external_calls as number) ?? 0;
        const prevAvgLatency = (agent.avg_latency_ms as number) ?? 0;
        const newTotalCalls = prevCalls + agg.totalCalls;

        let newAvgLatency = prevAvgLatency;
        if (agg.durationCount > 0) {
          const batchAvg = agg.totalDurationMs / agg.durationCount;
          newAvgLatency = prevCalls > 0
            ? Math.round((prevAvgLatency * prevCalls + batchAvg * agg.durationCount) / (prevCalls + agg.durationCount))
            : Math.round(batchAvg);
        }

        await admin
          .from("agents")
          .update({
            total_external_calls: newTotalCalls,
            avg_latency_ms: newAvgLatency,
          })
          .eq("id", agentId);
      }
    });

    // ── 4. Update self trust signals ────────────────────────────────
    await step.run("update-trust-signals", async () => {
      for (const [agentId, agg] of agentAggs) {
        if (agg.totalCalls === 0) continue;

        const { data: existing } = await admin
          .from("trust_edges")
          .select("id, total_jobs, successful_jobs, total_spent, avg_latency_ms")
          .eq("source_agent_id", agentId)
          .eq("target_agent_id", agentId)
          .single();

        const avgLatency = agg.durationCount > 0
          ? Math.round(agg.totalDurationMs / agg.durationCount)
          : 0;

        if (existing) {
          const newTotal = (existing.total_jobs as number) + agg.totalCalls;
          const newSuccessful = (existing.successful_jobs as number) + agg.successfulCalls;
          const successRate = newSuccessful / Math.max(1, newTotal);
          const newSpent = (existing.total_spent as number) + agg.totalCost;
          const stakeWeight = 1.0 + Math.log(1.0 + newSpent);
          const trustScore = Math.min(1.0, successRate * stakeWeight);
          const oldAvg = (existing.avg_latency_ms as number) ?? 0;
          const newAvg = Math.round((oldAvg * (existing.total_jobs as number) + avgLatency * agg.totalCalls) / Math.max(1, newTotal));

          await admin
            .from("trust_edges")
            .update({
              total_jobs: newTotal,
              successful_jobs: newSuccessful,
              total_spent: newSpent,
              avg_latency_ms: newAvg,
              last_job_at: new Date().toISOString(),
              trust_score: Math.round(trustScore * 10000) / 10000,
              stale: false,
            })
            .eq("id", existing.id);
        } else {
          const successRate = agg.totalCalls > 0 ? agg.successfulCalls / agg.totalCalls : 1;
          const stakeWeight = 1.0 + Math.log(1.0 + agg.totalCost);
          const trustScore = Math.min(1.0, successRate * stakeWeight);

          await admin.from("trust_edges").insert({
            source_agent_id: agentId,
            target_agent_id: agentId,
            total_jobs: agg.totalCalls,
            successful_jobs: agg.successfulCalls,
            production_jobs: agg.totalCalls,
            total_spent: agg.totalCost,
            avg_latency_ms: avgLatency,
            last_job_at: new Date().toISOString(),
            trust_score: Math.round(trustScore * 10000) / 10000,
          });
        }
      }
    });

    // ── 5. Reliability snapshots + auto-guardrail checks ───────────
    const reliability = await step.run("reliability-and-guardrail", async () => {
      let snapshots = 0;
      let rollbacksTriggered = 0;

      for (const [agentId, agg] of agentAggs) {
        if (agg.totalCalls === 0) continue;

        const [{ data: agent }, { data: trustEdge }, { data: previous }] = await Promise.all([
          admin
            .from("agents")
            .select("id, slug, health_status, health_score, avg_latency_ms, freeze_until")
            .eq("id", agentId)
            .single(),
          admin
            .from("trust_edges")
            .select("trust_score")
            .eq("source_agent_id", agentId)
            .eq("target_agent_id", agentId)
            .maybeSingle(),
          admin
            .from("agent_reliability_snapshots")
            .select("id")
            .eq("agent_id", agentId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        if (!agent?.slug) continue;

        const successRate = agg.successfulCalls / Math.max(1, agg.totalCalls);
        const errorRate = 1 - successRate;
        const avgLatency = agg.durationCount > 0
          ? Math.round(agg.totalDurationMs / agg.durationCount)
          : Math.max(0, Math.round((agent.avg_latency_ms as number | null) ?? 0));
        const trustScore = Number(trustEdge?.trust_score ?? 0);
        const healthComponent = healthToComponent(
          (agent.health_status as string | null) ?? null,
          agent.health_score == null ? null : Number(agent.health_score)
        );

        const result = computeReliabilityScore({
          successRate,
          errorRate,
          avgLatencyMs: avgLatency,
          trustScore,
          healthComponent,
        });

        await admin.from("agent_reliability_snapshots").insert({
          agent_id: agentId,
          source: "telemetry_rollup",
          sample_size: agg.totalCalls,
          success_rate: successRate,
          error_rate: errorRate,
          avg_latency_ms: avgLatency,
          trust_score: trustScore,
          health_component: healthComponent,
          reliability_score: result.score,
          reliability_band: result.band === "unknown" ? "watch" : result.band,
          drivers: result.drivers,
        });

        const freezeUntil = agent.freeze_until ? new Date(agent.freeze_until as string) : null;
        const now = Date.now();
        const frozenActive = freezeUntil ? freezeUntil.getTime() > now : false;

        await admin
          .from("agents")
          .update({
            reliability_score: result.score,
            reliability_band: result.band,
            reliability_checked_at: new Date().toISOString(),
            traffic_mode: frozenActive ? "frozen" : previous ? "normal" : "canary",
            canary_percent: frozenActive ? 0 : previous ? 100 : 20,
          })
          .eq("id", agentId);

        const rollback = await processRollbackForAgent({
          agentSlug: agent.slug as string,
          metrics: {
            sample_size: agg.totalCalls,
            error_rate: errorRate,
            avg_latency_ms: avgLatency,
            success_rate: successRate,
            trust_score: trustScore,
          },
          source: "telemetry_rollup",
          triggerMode: "auto",
        });

        if (rollback.should_trigger) {
          rollbacksTriggered++;
        }

        snapshots++;
      }

      return { snapshots, rollbacksTriggered };
    });

    // ── 6. Mark rows as rolled up ───────────────────────────────────
    await step.run("mark-rolled-up", async () => {
      const ids = rows.map((r) => r.id as string);
      const { error } = await admin
        .from("agent_telemetry")
        .update({ rolled_up: true })
        .in("id", ids);

      if (error) throw new Error(`Mark rolled_up failed: ${error.message}`);
    });

    return {
      processed: rows.length,
      agents: agentAggs.size,
      reliability_snapshots: reliability.snapshots,
      rollbacks_triggered: reliability.rollbacksTriggered,
    };
  }
);
