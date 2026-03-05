// Tier 2 — Community Panel (Hardened)
// Now calls real agent MCP endpoints for panel votes instead of simulated Claude calls.
// Falls back to Claude Haiku per-agent when MCP is unreachable.
// Escalates to Tier 3 (The Arbiter final judgment) on split votes.

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleDispute } from "@/lib/escrow";
import { callPanelAgent } from "@/lib/dispute/panel";
import type { DisputeEvidence } from "@/lib/dispute/types";

export const resolveDisputeT2 = inngest.createFunction(
  {
    id: "resolve-dispute-t2",
    name: "Resolve Dispute — Tier 2 (Community Panel)",
    retries: 2,
  },
  { event: "dispute/escalated-t2" },
  async ({ event, step }) => {
    const { dispute_id, job_id } = event.data;
    const admin = createAdminClient();

    // Step 1: fetch dispute evidence and job details to build context for panel
    const evidence = await step.run("fetch-evidence", async () => {
      const { data: dispute } = await admin
        .from("disputes")
        .select(
          "*, jobs(id, rate_amount, input_summary, output_summary, provider_agent_id, requester_profile_id, capability_used)"
        )
        .eq("id", dispute_id)
        .single();

      if (!dispute) throw new Error(`Dispute ${dispute_id} not found`);

      const job = (dispute as Record<string, unknown>).jobs as Record<
        string,
        unknown
      > | null;

      const { data: providerAgent } = await admin
        .from("agents")
        .select("id, name, slug, owner_id, output_schema, capability_schema")
        .eq("id", job?.provider_agent_id as string)
        .single();

      const inputSummary = job?.input_summary as Record<string, unknown> | null;
      const outputSummary = job?.output_summary as Record<string, unknown> | null;
      const inputEnvelope = inputSummary?._envelope ?? null;
      const outputEnvelope = outputSummary?._envelope ?? null;
      const verified =
        (outputEnvelope as Record<string, unknown> | null)?.verified ?? "unknown";

      return {
        dispute_id,
        job_id,
        dispute_reason: (dispute as Record<string, unknown>).reason as string,
        resolver_notes_t1: (dispute as Record<string, unknown>).resolver_notes as string | null,
        input_envelope: inputEnvelope as Record<string, unknown> | null,
        output_envelope: outputEnvelope as Record<string, unknown> | null,
        verified: verified as boolean | string,
        provider_agent_id: providerAgent?.id ?? null,
        provider_agent_name: providerAgent?.name ?? "Unknown Agent",
        provider_owner_id: providerAgent?.owner_id ?? null,
        requester_profile_id: job?.requester_profile_id as string | null,
        capability: (job?.capability_used as string) ?? null,
        rate_amount: (job?.rate_amount as number) ?? null,
        capability_schema: (providerAgent?.capability_schema as Record<string, unknown>) ?? null,
        output_schema: (providerAgent?.output_schema as Record<string, unknown>) ?? null,
      };
    });

    // Step 2: select 5 panel agents by highest average trust score, excluding conflicted parties
    const panelAgents = await step.run("select-panel", async () => {
      const excludeAgentId = evidence.provider_agent_id ?? "00000000-0000-0000-0000-000000000000";
      const excludeOwner1 = evidence.requester_profile_id ?? "00000000-0000-0000-0000-000000000000";
      const excludeOwner2 = evidence.provider_owner_id ?? "00000000-0000-0000-0000-000000000000";

      const { data: candidates } = await admin
        .from("agents")
        .select("id, name, slug, owner_id, mcp_endpoint")
        .neq("id", excludeAgentId)
        .neq("owner_id", excludeOwner1)
        .neq("owner_id", excludeOwner2)
        .limit(50);

      if (!candidates || candidates.length === 0) return [];

      // Get average trust scores from trust_edges
      const agentIds = candidates.map((a) => a.id);
      const { data: trustEdges } = await admin
        .from("trust_edges")
        .select("target_agent_id, trust_score")
        .in("target_agent_id", agentIds)
        .eq("stale", false);

      // Compute avg trust per agent
      const trustMap: Record<string, { sum: number; count: number }> = {};
      for (const edge of trustEdges ?? []) {
        if (!trustMap[edge.target_agent_id]) {
          trustMap[edge.target_agent_id] = { sum: 0, count: 0 };
        }
        trustMap[edge.target_agent_id].sum += edge.trust_score;
        trustMap[edge.target_agent_id].count += 1;
      }

      const ranked = candidates
        .filter((a) => trustMap[a.id]) // only agents with trust scores
        .map((a) => ({
          ...a,
          avg_trust: trustMap[a.id].sum / trustMap[a.id].count,
        }))
        .sort((a, b) => b.avg_trust - a.avg_trust)
        .slice(0, 5);

      return ranked;
    });

    // If fewer than 3 agents available, escalate directly to Tier 3
    if (panelAgents.length < 3) {
      await step.run("escalate-t3-insufficient-panel", async () => {
        await admin
          .from("disputes")
          .update({
            tier: 3,
            status: "reviewing",
            resolver_notes: `[Tier 2 — Escalated to Tier 3: insufficient panel agents (${panelAgents.length} available, need 3)]`,
          })
          .eq("id", dispute_id);

        // Fire T3 event for automated Arbiter resolution
        await inngest.send({
          name: "dispute/escalated-t3",
          data: { dispute_id, job_id },
        });
      });

      return {
        dispute_id,
        outcome: "escalated-t3",
        reason: "insufficient_panel",
        panel_size: panelAgents.length,
      };
    }

    // Step 3: call real agent MCP endpoints for panel votes (with Claude fallback)
    const votes = await step.run("record-panel-votes", async () => {
      // Build a DisputeEvidence object for the panel calls
      const panelEvidence: DisputeEvidence = {
        dispute_id: evidence.dispute_id,
        job_id: evidence.job_id,
        dispute_reason: evidence.dispute_reason,
        agent_name: evidence.provider_agent_name,
        capability: evidence.capability,
        rate_amount: evidence.rate_amount,
        input_envelope: evidence.input_envelope,
        output_envelope: evidence.output_envelope,
        capability_schema: evidence.capability_schema,
        output_schema: evidence.output_schema,
        schema_valid: evidence.verified,
      };

      const results: Array<{
        agent_id: string;
        agent_name: string;
        vote: "upheld" | "rejected";
        reasoning: string;
        source: "mcp" | "fallback";
      }> = [];

      for (const agent of panelAgents) {
        // Call real MCP endpoint (or fallback to Claude)
        const panelVote = await callPanelAgent(
          agent.id,
          agent.name,
          agent.slug,
          agent.mcp_endpoint ?? null,
          panelEvidence
        );

        // Record vote in dispute_panel_votes
        await admin.from("dispute_panel_votes").upsert(
          {
            dispute_id,
            agent_id: agent.id,
            vote: panelVote.vote,
            reasoning: panelVote.reasoning,
          },
          { onConflict: "dispute_id,agent_id" }
        );

        results.push({
          agent_id: panelVote.agent_id,
          agent_name: panelVote.agent_name,
          vote: panelVote.vote,
          reasoning: panelVote.reasoning,
          source: panelVote.source,
        });
      }

      return results;
    });

    // Step 4: tally votes and resolve or escalate to T3
    await step.run("tally-votes", async () => {
      const upheldCount = votes.filter((v) => v.vote === "upheld").length;
      const rejectedCount = votes.filter((v) => v.vote === "rejected").length;
      const total = votes.length;
      const mcpCount = votes.filter((v) => v.source === "mcp").length;
      const fallbackCount = votes.filter((v) => v.source === "fallback").length;

      const voteBreakdown = votes
        .map((v) => `${v.agent_name}: ${v.vote} [${v.source}] — ${v.reasoning}`)
        .join("\n");

      const tally = `${upheldCount} uphold / ${rejectedCount} reject (of ${total} panel votes, ${mcpCount} MCP / ${fallbackCount} fallback)`;

      // Majority: 3+ of 5 agree
      if (upheldCount >= 3) {
        await admin
          .from("disputes")
          .update({
            status: "resolved",
            resolution: "upheld",
            resolver_notes: `[Tier 2 Panel — ${tally}]\n\n${voteBreakdown}`,
            resolved_at: new Date().toISOString(),
            tier: 2,
          })
          .eq("id", dispute_id);

        await settleDispute(dispute_id, "upheld", job_id);
      } else if (rejectedCount >= 3) {
        await admin
          .from("disputes")
          .update({
            status: "resolved",
            resolution: "rejected",
            resolver_notes: `[Tier 2 Panel — ${tally}]\n\n${voteBreakdown}`,
            resolved_at: new Date().toISOString(),
            tier: 2,
          })
          .eq("id", dispute_id);

        await settleDispute(dispute_id, "rejected", job_id);
      } else {
        // Split vote — escalate to Tier 3 (The Arbiter)
        await admin
          .from("disputes")
          .update({
            tier: 3,
            status: "reviewing",
            resolver_notes: `[Tier 2 Panel — Split: ${tally} — escalated to Tier 3]\n\n${voteBreakdown}`,
          })
          .eq("id", dispute_id);

        // Fire T3 event for automated Arbiter resolution
        await inngest.send({
          name: "dispute/escalated-t3",
          data: { dispute_id, job_id },
        });
      }

      return { upheldCount, rejectedCount, tally };
    });

    const upheldFinal = votes.filter((v) => v.vote === "upheld").length;
    const rejectedFinal = votes.filter((v) => v.vote === "rejected").length;

    return {
      dispute_id,
      panel_size: panelAgents.length,
      upheld: upheldFinal,
      rejected: rejectedFinal,
      outcome:
        upheldFinal >= 3
          ? "resolved-upheld"
          : rejectedFinal >= 3
          ? "resolved-rejected"
          : "escalated-t3",
    };
  }
);
