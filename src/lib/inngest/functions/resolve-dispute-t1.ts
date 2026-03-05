// Tier 1 — The Arbiter (AI Single-Judge)
// Hardened: calls The Arbiter agent via MCP endpoint instead of raw Claude.
// Falls back to Claude Haiku if The Arbiter is unreachable.
// Auto-resolves at ≥0.85 confidence, otherwise escalates to T2 panel.

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { callArbiter } from "@/lib/dispute/arbiter";
import type { DisputeEvidence } from "@/lib/dispute/types";

export const resolveDisputeT1 = inngest.createFunction(
  {
    id: "resolve-dispute-t1",
    name: "Resolve Dispute — Tier 1 (The Arbiter)",
    retries: 2,
  },
  { event: "dispute/filed" },
  async ({ event, step }) => {
    const { dispute_id, job_id } = event.data;
    const admin = createAdminClient();

    // Step 1: fetch all evidence
    const evidence = await step.run("fetch-evidence", async () => {
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

      // Fetch agent capability schema
      const { data: agent } = await admin
        .from("agents")
        .select("name, slug, capability_schema, output_schema")
        .eq("id", job?.provider_agent_id as string)
        .single();

      const inputSummary = job?.input_summary as Record<string, unknown> | null;
      const outputSummary = job?.output_summary as Record<string, unknown> | null;
      const outputEnvelope = outputSummary?._envelope as Record<string, unknown> | null;

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
      };

      return evidenceBundle;
    });

    // Step 2: call The Arbiter (MCP endpoint → Claude fallback)
    const aiDecision = await step.run("arbiter-resolution", async () => {
      return callArbiter(evidence, 1);
    });

    // Step 3: resolve or escalate
    await step.run("resolve-or-escalate", async () => {
      const sourceLabel = aiDecision.source === "arbiter" ? "The Arbiter" : "AI Fallback";

      if (aiDecision.confidence >= 0.85) {
        // Auto-resolve
        await admin
          .from("disputes")
          .update({
            status: "resolved",
            resolution: aiDecision.decision,
            resolver_notes: `[Tier 1 ${sourceLabel} — confidence: ${(aiDecision.confidence * 100).toFixed(0)}%] ${aiDecision.reasoning}`,
            resolved_at: new Date().toISOString(),
            tier: 1,
          })
          .eq("id", dispute_id);

        // Settle deposits
        const { data: deposits } = await admin
          .from("dispute_deposits")
          .select("*")
          .eq("dispute_id", dispute_id);

        for (const deposit of deposits ?? []) {
          if (aiDecision.decision === "upheld") {
            // Refund requester deposit
            await admin
              .from("dispute_deposits")
              .update({ status: "returned" })
              .eq("id", deposit.id);

            // Add credits back via RPC (atomically increments balance)
            await admin.rpc("add_credits", {
              p_user_id: deposit.profile_id,
              p_amount_millicents: deposit.amount_millicents,
            });
          } else {
            // Rejected — provider wins, requester loses deposit to reserve
            await admin
              .from("dispute_deposits")
              .update({ status: "forfeited" })
              .eq("id", deposit.id);

            await admin.from("dispute_reserve").insert({
              job_id,
              source: "dispute_forfeit",
              amount_millicents: deposit.amount_millicents,
            });
          }
        }
      } else {
        // Escalate to Tier 2
        await admin
          .from("disputes")
          .update({
            status: "reviewing",
            tier: 2,
            resolver_notes: `[Tier 1 ${sourceLabel} — confidence: ${(aiDecision.confidence * 100).toFixed(0)}% — escalated] ${aiDecision.reasoning}`,
          })
          .eq("id", dispute_id);

        await inngest.send({
          name: "dispute/escalated-t2",
          data: { dispute_id, job_id },
        });
      }
    });

    return {
      dispute_id,
      decision: aiDecision.decision,
      confidence: aiDecision.confidence,
      source: aiDecision.source,
      auto_resolved: aiDecision.confidence >= 0.85,
    };
  }
);
