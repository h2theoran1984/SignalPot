// Arbiter engine — calls The Arbiter agent's MCP endpoint for dispute resolution.
// Mirrors the Arena callAgent() pattern (src/lib/arena/engine.ts).
// Falls back to raw Claude Haiku call if The Arbiter is unreachable.

import { createAdminClient } from "@/lib/supabase/admin";
import { wrapRequest, wrapResponse } from "@/lib/envelope";
import { validateOutput } from "@/lib/schema-validator";
import Anthropic from "@anthropic-ai/sdk";
import type { Agent } from "@/lib/types";
import type { DisputeEvidence, ArbiterResponse } from "./types";

const ARBITER_SLUG = "the-arbiter";
const ARBITER_CAPABILITY = "signalpot/arbitrate@v1";
const ARBITER_TIMEOUT_MS = 30_000;

const anthropic = new Anthropic();

/**
 * Call The Arbiter agent to render a dispute decision.
 * 1. Looks up The Arbiter agent from the DB
 * 2. Creates a job record (feeds trust graph)
 * 3. Calls the MCP endpoint with dispute evidence
 * 4. Falls back to raw Claude Haiku if MCP fails
 */
export async function callArbiter(
  evidence: DisputeEvidence,
  tier: 1 | 3
): Promise<ArbiterResponse> {
  const admin = createAdminClient();

  // Look up The Arbiter agent
  const { data: arbiter } = await admin
    .from("agents")
    .select("*")
    .eq("slug", ARBITER_SLUG)
    .eq("status", "active")
    .single();

  if (!arbiter || !arbiter.mcp_endpoint) {
    console.warn("[arbiter] The Arbiter agent not found or no endpoint — using fallback");
    return callClaudeFallback(evidence, tier);
  }

  // Create a job record for this arbitration
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      provider_agent_id: arbiter.id,
      requester_profile_id: null,
      requester_agent_id: null,
      job_type: "production",
      capability_used: ARBITER_CAPABILITY,
      input_summary: {
        dispute_id: evidence.dispute_id,
        dispute_reason: evidence.dispute_reason,
        agent_name: evidence.agent_name,
        tier,
      },
      status: "pending",
      cost: 0,
      verified: false,
    })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("[arbiter] Failed to create job:", jobError?.message);
    return callClaudeFallback(evidence, tier);
  }

  const jobId = job.id as string;

  // Build request envelope
  const requestEnvelope = wrapRequest({
    jobId,
    callerId: `dispute:${evidence.dispute_id}`,
    providerSlug: ARBITER_SLUG,
    capability: ARBITER_CAPABILITY,
    input: {
      dispute_reason: evidence.dispute_reason,
      agent_name: evidence.agent_name,
      capability: evidence.capability,
      input_envelope: evidence.input_envelope,
      output_envelope: evidence.output_envelope,
      capability_schema: evidence.capability_schema,
      output_schema: evidence.output_schema,
      schema_valid: evidence.schema_valid,
      rate_amount: evidence.rate_amount,
      tier,
      prior_decisions: evidence.prior_decisions,
    },
  });

  // Update job to running
  await admin
    .from("jobs")
    .update({
      input_summary: { dispute_id: evidence.dispute_id, tier, _envelope: requestEnvelope },
      status: "running",
    })
    .eq("id", jobId);

  // Call The Arbiter's MCP endpoint
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ARBITER_TIMEOUT_MS);

    const res = await fetch(arbiter.mcp_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capability: ARBITER_CAPABILITY,
        input: {
          dispute_reason: evidence.dispute_reason,
          agent_name: evidence.agent_name,
          capability: evidence.capability,
          input_envelope: evidence.input_envelope,
          output_envelope: evidence.output_envelope,
          capability_schema: evidence.capability_schema,
          output_schema: evidence.output_schema,
          schema_valid: evidence.schema_valid,
          rate_amount: evidence.rate_amount,
          tier,
          prior_decisions: evidence.prior_decisions,
        },
        job_id: jobId,
        _envelope: requestEnvelope,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Arbiter returned ${res.status}`);
    }

    const agentResponse = (await res.json()) as Record<string, unknown>;
    const durationMs = Date.now() - startTime;

    // Validate output against The Arbiter's declared schema
    const capSchemas = (arbiter.capability_schema as unknown as Array<Record<string, unknown>>) ?? [];
    const matchedCap = capSchemas.find(
      (c) => (c as { name: string }).name === ARBITER_CAPABILITY
    );
    const outputSchema = (matchedCap?.outputSchema as Record<string, unknown>) ?? null;
    const validation = validateOutput(outputSchema, agentResponse);

    // Build response envelope and update job
    const responseEnvelope = wrapResponse({
      jobId,
      providerSlug: ARBITER_SLUG,
      durationMs,
      output: agentResponse,
      verified: validation.valid,
      validationErrors: validation.errors,
    });

    await admin
      .from("jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        output_summary: { ...agentResponse, _envelope: responseEnvelope },
        duration_ms: durationMs,
        verified: validation.valid,
      })
      .eq("id", jobId);

    // Parse the arbiter response
    const decision = agentResponse.decision as string;
    const confidence = agentResponse.confidence as number;
    const reasoning = agentResponse.reasoning as string;

    if (
      (decision === "upheld" || decision === "rejected" || decision === "partial") &&
      typeof confidence === "number" &&
      typeof reasoning === "string"
    ) {
      return { decision, confidence, reasoning, source: "arbiter" };
    }

    // Valid response but unexpected format — fall back
    console.warn("[arbiter] Unexpected response format — using fallback");
    await admin
      .from("jobs")
      .update({ verified: false })
      .eq("id", jobId);

    return callClaudeFallback(evidence, tier);
  } catch (err) {
    const durationMs = Date.now() - startTime;

    await admin
      .from("jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
      })
      .eq("id", jobId);

    const message = err instanceof Error ? err.message : "Arbiter unreachable";
    console.warn(`[arbiter] MCP call failed (${message}) — using fallback`);
    return callClaudeFallback(evidence, tier);
  }
}

/**
 * Claude Haiku fallback — identical to the original T1 AI resolution logic.
 * Used when The Arbiter MCP endpoint is unreachable or returns invalid output.
 */
async function callClaudeFallback(
  evidence: DisputeEvidence,
  tier: 1 | 3
): Promise<ArbiterResponse> {
  const outputEnvelope = evidence.output_envelope as Record<string, unknown> | null;

  const priorContext =
    tier === 3 && evidence.prior_decisions?.length
      ? `\n## Prior Tier Decisions:\n${evidence.prior_decisions
          .map(
            (p) =>
              `- Tier ${p.tier}: ${p.decision}${p.confidence != null ? ` (confidence: ${(p.confidence * 100).toFixed(0)}%)` : ""}${p.votes ? ` [votes: ${p.votes.upheld} uphold / ${p.votes.rejected} reject]` : ""} — ${p.reasoning}`
          )
          .join("\n")}\n\nYou are the FINAL arbiter. Consider the full decision chain above.`
      : "";

  const prompt = `You are The Arbiter, an impartial dispute resolver for SignalPot, an AI agent marketplace.

A requester has filed a dispute against an agent provider. Your job is to analyze the evidence and decide if the dispute should be upheld (requester wins), rejected (provider wins), or partially upheld.

## Agent: ${evidence.agent_name}
## Capability used: ${evidence.capability ?? "unknown"}
## Rate charged: $${evidence.rate_amount}
## Resolution Tier: ${tier}

## Dispute reason (filed by requester):
${evidence.dispute_reason}

## Input sent to agent:
${evidence.input_envelope ? JSON.stringify(evidence.input_envelope, null, 2) : "No input envelope available"}

## Output returned by agent:
${evidence.output_envelope ? JSON.stringify(evidence.output_envelope, null, 2) : "No output envelope available"}

## Output was schema-validated: ${outputEnvelope?.verified ?? "unknown"}
${Array.isArray(outputEnvelope?.validation_errors) && (outputEnvelope.validation_errors as string[]).length ? `## Schema validation errors:\n${(outputEnvelope.validation_errors as string[]).join("\n")}` : ""}

## Agent's declared output schema:
${evidence.output_schema ? JSON.stringify(evidence.output_schema, null, 2) : "No output schema declared"}
${priorContext}

## Instructions:
Respond with ONLY valid JSON in this exact format:
{
  "decision": "upheld" | "rejected" | "partial",
  "confidence": 0.0 to 1.0,
  "reasoning": "1-3 sentence explanation"
}

- "upheld" means the requester's complaint is valid and they should be refunded
- "rejected" means the agent performed adequately and the provider should keep payment
- "partial" means both parties share some fault
- confidence must reflect how certain you are${tier === 1 ? " (0.85+ = auto-resolve, below = escalate to panel)" : " (this is the final decision — be decisive)"}
- If evidence is insufficient or ambiguous, ${tier === 1 ? "set confidence below 0.85" : "make the best judgment you can"}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]) as {
      decision: "upheld" | "rejected" | "partial";
      confidence: number;
      reasoning: string;
    };

    return {
      decision: parsed.decision,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      source: "fallback",
    };
  } catch {
    return {
      decision: "rejected",
      confidence: 0.5,
      reasoning: "AI response could not be parsed — escalating.",
      source: "fallback",
    };
  }
}
