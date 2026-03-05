// Tier 3 — The Arbiter's Final Judgment.
// Automated final resolution for disputes that T1 and T2 could not resolve.
// Calls The Arbiter with full decision chain (T1 decision + T2 vote breakdown).
// No confidence threshold — The Arbiter's T3 decision is final.

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleDispute } from "@/lib/escrow";
import { callArbiter } from "@/lib/dispute/arbiter";
import type { DisputeEvidence, PriorDecision } from "@/lib/dispute/types";

export const resolveDisputeT3 = inngest.createFunction(
  {
    id: "resolve-dispute-t3",
    name: "Resolve Dispute — Tier 3 (The Arbiter)",
    retries: 1,
  },
  { event: "dispute/escalated-t3" },
  async ({ event, step }) => {
    const { dispute_id, job_id } = event.data;
    const admin = createAdminClient();

    // Step 1: gather full evidence + prior tier decisions
    const evidence = await step.run("gather-full-evidence", async () => {
      // Fetch dispute + job + agent
      const { data: dispute } = await admin
        .from("disputes")
        .select(
          "*, jobs(id, rate_amount, input_summary, output_summary, provider_agent_id, capability_used)"
        )
        .eq("id", dispute_id)
        .single();

      if (!dispute) throw new Error(`Dispute ${dispute_id} not found`);

      const job = (dispute as Record<string, unknown>).jobs as Record<
        string,
        unknown
      > | null;

      // Fetch provider agent details
      const { data: agent } = await admin
        .from("agents")
        .select("name, slug, capability_schema, output_schema")
        .eq("id", job?.provider_agent_id as string)
        .single();

      const inputSummary = job?.input_summary as Record<string, unknown> | null;
      const outputSummary = job?.output_summary as Record<string, unknown> | null;
      const outputEnvelope = outputSummary?._envelope as Record<string, unknown> | null;

      // Fetch T2 panel votes for decision chain
      const { data: panelVotes } = await admin
        .from("dispute_panel_votes")
        .select("agent_id, vote, reasoning")
        .eq("dispute_id", dispute_id);

      const upheldVotes = (panelVotes ?? []).filter((v) => v.vote === "upheld").length;
      const rejectedVotes = (panelVotes ?? []).filter((v) => v.vote === "rejected").length;
      const totalVotes = (panelVotes ?? []).length;

      // Parse T1 decision from resolver_notes
      const resolverNotes = (dispute as Record<string, unknown>).resolver_notes as string | null;
      const t1ConfidenceMatch = resolverNotes?.match(/confidence:\s*(\d+)%/);
      const t1Confidence = t1ConfidenceMatch
        ? parseInt(t1ConfidenceMatch[1]) / 100
        : undefined;

      // Build prior decisions array
      const priorDecisions: PriorDecision[] = [];

      // T1 decision (always exists if we got to T3)
      if (resolverNotes) {
        const t1DecisionMatch = resolverNotes.match(/Tier 1 AI/);
        if (t1DecisionMatch) {
          priorDecisions.push({
            tier: 1,
            decision: "escalated",
            confidence: t1Confidence,
            reasoning: resolverNotes.split("]").slice(1).join("]").trim().split("\n")[0] || "Escalated due to low confidence",
          });
        }
      }

      // T2 decision (if panel votes exist)
      if (totalVotes > 0) {
        const voteBreakdown = (panelVotes ?? [])
          .map((v) => `${v.vote}: ${v.reasoning}`)
          .join("; ");

        priorDecisions.push({
          tier: 2,
          decision: "escalated",
          reasoning: `Split vote — ${voteBreakdown}`,
          votes: { upheld: upheldVotes, rejected: rejectedVotes, total: totalVotes },
        });
      }

      const evidenceBundle: DisputeEvidence = {
        dispute_id,
        job_id,
        dispute_reason: (dispute as Record<string, unknown>).reason as string,
        agent_name: agent?.name ?? "Unknown Agent",
        capability: (job?.capability_used as string) ?? null,
        rate_amount: (job?.rate_amount as number) ?? null,
        input_envelope: (inputSummary?._envelope as Record<string, unknown>) ?? null,
        output_envelope: outputEnvelope ?? null,
        capability_schema: (agent?.capability_schema as Record<string, unknown>) ?? null,
        output_schema: (agent?.output_schema as Record<string, unknown>) ?? null,
        schema_valid: (outputEnvelope?.verified as boolean | string) ?? "unknown",
        prior_decisions: priorDecisions,
      };

      return evidenceBundle;
    });

    // Step 2: call The Arbiter for final judgment
    const arbiterDecision = await step.run("final-judgment", async () => {
      return callArbiter(evidence, 3);
    });

    // Step 3: resolve the dispute — T3 is final, no more escalation
    await step.run("resolve-final", async () => {
      const decisionChain = [
        ...(evidence.prior_decisions ?? []).map(
          (p) =>
            `Tier ${p.tier}: ${p.decision}${p.confidence != null ? ` (${(p.confidence * 100).toFixed(0)}%)` : ""}${p.votes ? ` [${p.votes.upheld}/${p.votes.rejected}/${p.votes.total}]` : ""} — ${p.reasoning}`
        ),
        `Tier 3 (The Arbiter): ${arbiterDecision.decision} (${(arbiterDecision.confidence * 100).toFixed(0)}%) — ${arbiterDecision.reasoning} [source: ${arbiterDecision.source}]`,
      ].join("\n");

      // Resolve the dispute
      await admin
        .from("disputes")
        .update({
          status: "resolved",
          resolution: arbiterDecision.decision,
          resolver_notes: `[Tier 3 — The Arbiter — Final Judgment]\n\n${decisionChain}`,
          resolved_at: new Date().toISOString(),
          tier: 3,
        })
        .eq("id", dispute_id);

      // Settle deposits
      await settleDispute(dispute_id, arbiterDecision.decision, job_id);
    });

    return {
      dispute_id,
      decision: arbiterDecision.decision,
      confidence: arbiterDecision.confidence,
      source: arbiterDecision.source,
      tier: 3,
      final: true,
    };
  }
);
