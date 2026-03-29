// Telemetry Rollup — processes unrolled agent_telemetry rows every 5 minutes.
// Updates: agent stats (total_external_calls, avg_latency_ms), trust_edges,
// and marks rows as rolled up.

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";

const BATCH_SIZE = 500;

export const telemetryRollup = inngest.createFunction(
  { id: "telemetry-rollup", name: "Telemetry Rollup" },
  { cron: "*/5 * * * *" }, // every 5 minutes
  async ({ step }) => {
    const admin = createAdminClient();

    // ── 1. Fetch unprocessed rows ───────────────────────────────────
    const rows = await step.run("fetch-pending", async () => {
      const { data, error } = await admin
        .from("agent_telemetry")
        .select("id, agent_id, event, capability, duration_ms, api_cost, cost, success, caller")
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
    interface AgentAgg {
      totalCalls: number;
      successfulCalls: number;
      totalDurationMs: number;
      durationCount: number;
      totalApiCost: number;
      totalCost: number;
      capabilities: Set<string>;
      callers: Set<string>;
    }

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
          capabilities: new Set(),
          callers: new Set(),
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
      if (row.capability) agg.capabilities.add(row.capability as string);
      if (row.caller) agg.callers.add(row.caller as string);
    }

    // ── 3. Update agent stats ───────────────────────────────────────
    await step.run("update-agent-stats", async () => {
      for (const [agentId, agg] of agentAggs) {
        // Fetch current stats for running average
        const { data: agent } = await admin
          .from("agents")
          .select("total_external_calls, avg_latency_ms")
          .eq("id", agentId)
          .single();

        if (!agent) continue;

        const prevCalls = (agent.total_external_calls as number) ?? 0;
        const prevAvgLatency = (agent.avg_latency_ms as number) ?? 0;
        const newTotalCalls = prevCalls + agg.totalCalls;

        // Running average for latency
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

    // ── 4. Update trust edges for external callers ──────────────────
    // External calls don't have a requester agent, so we create a
    // synthetic "external-usage" trust signal by incrementing the
    // agent's self-referential trust (total_jobs, successful_jobs).
    // This keeps the trust score alive and prevents decay.
    await step.run("update-trust-signals", async () => {
      for (const [agentId, agg] of agentAggs) {
        if (agg.totalCalls === 0) continue;

        // Upsert a self-referential trust edge to track external reliability
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
          const successRate = newSuccessful / newTotal;
          const newSpent = (existing.total_spent as number) + agg.totalCost;
          const stakeWeight = 1.0 + Math.log(1.0 + newSpent);
          const trustScore = Math.min(1.0, successRate * stakeWeight);
          const oldAvg = (existing.avg_latency_ms as number) ?? 0;
          const newAvg = Math.round(
            (oldAvg * (existing.total_jobs as number) + avgLatency * agg.totalCalls) / newTotal
          );

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
            production_jobs: agg.totalCalls, // external = production
            total_spent: agg.totalCost,
            avg_latency_ms: avgLatency,
            last_job_at: new Date().toISOString(),
            trust_score: Math.round(trustScore * 10000) / 10000,
          });
        }
      }
    });

    // ── 5. Mark rows as rolled up ───────────────────────────────────
    await step.run("mark-rolled-up", async () => {
      const ids = rows.map((r) => r.id as string);
      const { error } = await admin
        .from("agent_telemetry")
        .update({ rolled_up: true })
        .in("id", ids);

      if (error) throw new Error(`Mark rolled_up failed: ${error.message}`);
    });

    return { processed: rows.length, agents: agentAggs.size };
  }
);
