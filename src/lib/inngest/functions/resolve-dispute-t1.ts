import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
// NOTE: @anthropic-ai/sdk must be installed: npm install @anthropic-ai/sdk
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export const resolveDisputeT1 = inngest.createFunction(
  {
    id: "resolve-dispute-t1",
    name: "Resolve Dispute — Tier 1 (AI)",
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

      return {
        dispute_reason: (dispute as Record<string, unknown>).reason as string,
        rate_amount: job?.rate_amount as number | null,
        input_envelope: inputSummary?._envelope ?? null,
        output_envelope: outputSummary?._envelope ?? null,
        capability_used: (job?.capability_used as string) ?? null,
        agent_name: agent?.name ?? "Unknown Agent",
        output_schema: agent?.output_schema ?? null,
        capability_schema: agent?.capability_schema ?? null,
      };
    });

    // Step 2: call Claude for AI resolution
    const aiDecision = await step.run("ai-resolution", async () => {
      const outputEnvelope = evidence.output_envelope as Record<
        string,
        unknown
      > | null;

      const prompt = `You are an impartial dispute resolver for SignalPot, an AI agent marketplace.

A requester has filed a dispute against an agent provider. Your job is to analyze the evidence and decide if the dispute should be upheld (requester wins) or rejected (provider wins).

## Agent: ${evidence.agent_name}
## Capability used: ${evidence.capability_used ?? "unknown"}
## Rate charged: $${evidence.rate_amount}

## Dispute reason (filed by requester):
${evidence.dispute_reason}

## Input sent to agent:
${evidence.input_envelope ? JSON.stringify(evidence.input_envelope, null, 2) : "No input envelope available"}

## Output returned by agent:
${evidence.output_envelope ? JSON.stringify(evidence.output_envelope, null, 2) : "No output envelope available"}

## Output was schema-validated: ${outputEnvelope?.verified ?? "unknown"}
${Array.isArray(outputEnvelope?.validation_errors) && outputEnvelope.validation_errors.length ? `## Schema validation errors:\n${(outputEnvelope.validation_errors as string[]).join("\n")}` : ""}

## Agent's declared output schema:
${evidence.output_schema ? JSON.stringify(evidence.output_schema, null, 2) : "No output schema declared"}

## Instructions:
Respond with ONLY valid JSON in this exact format:
{
  "decision": "upheld" | "rejected",
  "confidence": 0.0 to 1.0,
  "reasoning": "1-3 sentence explanation"
}

- "upheld" means the requester's complaint is valid and they should be refunded
- "rejected" means the agent performed adequately and the provider should keep payment
- confidence must reflect how certain you are (0.85+ = auto-resolve, below = escalate to human panel)
- If evidence is insufficient or ambiguous, set confidence below 0.85`;

      const message = await anthropic.messages.create({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      });

      const text =
        message.content[0].type === "text" ? message.content[0].text : "";

      try {
        // Extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON in response");
        return JSON.parse(jsonMatch[0]) as {
          decision: "upheld" | "rejected";
          confidence: number;
          reasoning: string;
        };
      } catch {
        // If parsing fails, escalate
        return {
          decision: "rejected" as const,
          confidence: 0.5,
          reasoning: "AI response could not be parsed — escalating to panel.",
        };
      }
    });

    // Step 3: resolve or escalate
    await step.run("resolve-or-escalate", async () => {
      if (aiDecision.confidence >= 0.85) {
        // Auto-resolve
        await admin
          .from("disputes")
          .update({
            status: "resolved",
            resolution: aiDecision.decision,
            resolver_notes: `[Tier 1 AI — confidence: ${(aiDecision.confidence * 100).toFixed(0)}%] ${aiDecision.reasoning}`,
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

            // 50% to platform reserve (simplified: all to reserve for now)
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
            resolver_notes: `[Tier 1 AI — confidence: ${(aiDecision.confidence * 100).toFixed(0)}% — escalated] ${aiDecision.reasoning}`,
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
      auto_resolved: aiDecision.confidence >= 0.85,
    };
  }
);
