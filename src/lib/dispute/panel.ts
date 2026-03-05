// Panel engine — calls real agent MCP endpoints for T2 community panel votes.
// Falls back to Claude Haiku simulated votes when agents are unreachable.
// Mirrors the Arena callAgent() pattern (src/lib/arena/engine.ts).

import { createAdminClient } from "@/lib/supabase/admin";
import { wrapRequest, wrapResponse } from "@/lib/envelope";
import Anthropic from "@anthropic-ai/sdk";
import type { DisputeEvidence, PanelVote } from "./types";

const PANEL_TIMEOUT_MS = 15_000;

const anthropic = new Anthropic();

/**
 * Call a panel agent's MCP endpoint to get its dispute vote.
 * Creates a job record (feeds trust graph), calls MCP, validates response.
 * Falls back to Claude Haiku simulated vote on failure.
 */
export async function callPanelAgent(
  agentId: string,
  agentName: string,
  agentSlug: string,
  mcpEndpoint: string | null,
  evidence: DisputeEvidence
): Promise<PanelVote> {
  const admin = createAdminClient();

  // If agent has no MCP endpoint, go straight to fallback
  if (!mcpEndpoint) {
    return callPanelFallback(agentId, agentName, evidence);
  }

  // Create a job record for this panel vote
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      provider_agent_id: agentId,
      requester_profile_id: null,
      requester_agent_id: null,
      job_type: "production",
      capability_used: "dispute-panel-vote",
      input_summary: {
        dispute_id: evidence.dispute_id,
        role: "panel_voter",
      },
      status: "pending",
      cost: 0,
      verified: false,
    })
    .select("id")
    .single();

  if (jobError || !job) {
    console.warn(`[panel] Failed to create job for ${agentSlug}:`, jobError?.message);
    return callPanelFallback(agentId, agentName, evidence);
  }

  const jobId = job.id as string;

  // Build request envelope
  const requestEnvelope = wrapRequest({
    jobId,
    callerId: `dispute-panel:${evidence.dispute_id}`,
    providerSlug: agentSlug,
    capability: "dispute-panel-vote",
    input: {
      dispute_reason: evidence.dispute_reason,
      input_envelope: evidence.input_envelope,
      output_envelope: evidence.output_envelope,
      schema_valid: evidence.schema_valid,
    },
  });

  await admin
    .from("jobs")
    .update({
      input_summary: { dispute_id: evidence.dispute_id, role: "panel_voter", _envelope: requestEnvelope },
      status: "running",
    })
    .eq("id", jobId);

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PANEL_TIMEOUT_MS);

    const res = await fetch(mcpEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capability: "dispute-panel-vote",
        input: {
          dispute_reason: evidence.dispute_reason,
          input_envelope: evidence.input_envelope,
          output_envelope: evidence.output_envelope,
          schema_valid: evidence.schema_valid,
        },
        job_id: jobId,
        _envelope: requestEnvelope,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Panel agent ${agentSlug} returned ${res.status}`);
    }

    const agentResponse = (await res.json()) as Record<string, unknown>;
    const durationMs = Date.now() - startTime;

    // Build response envelope and update job
    const responseEnvelope = wrapResponse({
      jobId,
      providerSlug: agentSlug,
      durationMs,
      output: agentResponse,
      verified: true,
      validationErrors: [],
    });

    await admin
      .from("jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        output_summary: { ...agentResponse, _envelope: responseEnvelope },
        duration_ms: durationMs,
        verified: true,
      })
      .eq("id", jobId);

    // Parse the vote
    const vote = agentResponse.vote as string;
    const reasoning = (agentResponse.reasoning as string) ?? "No reasoning provided.";

    if (vote === "upheld" || vote === "rejected") {
      return {
        vote,
        reasoning,
        agent_id: agentId,
        agent_name: agentName,
        source: "mcp",
      };
    }

    // Invalid vote format — fall back
    console.warn(`[panel] Unexpected vote format from ${agentSlug} — using fallback`);
    return callPanelFallback(agentId, agentName, evidence);
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

    const message = err instanceof Error ? err.message : "Agent unreachable";
    console.warn(`[panel] MCP call to ${agentSlug} failed (${message}) — using fallback`);
    return callPanelFallback(agentId, agentName, evidence);
  }
}

/**
 * Claude Haiku fallback — simulates an agent's panel vote.
 * Identical to the original T2 logic per-agent call.
 */
async function callPanelFallback(
  agentId: string,
  agentName: string,
  evidence: DisputeEvidence
): Promise<PanelVote> {
  const inputStr = evidence.input_envelope
    ? JSON.stringify(evidence.input_envelope)
    : "N/A";
  const outputStr = evidence.output_envelope
    ? JSON.stringify(evidence.output_envelope)
    : "N/A";

  const prompt = `You are agent "${agentName}" on a dispute resolution panel.

Dispute reason: ${evidence.dispute_reason}
Input to agent: ${inputStr}
Output from agent: ${outputStr}
Output schema valid: ${evidence.schema_valid}

Vote: respond with JSON only: {"vote": "upheld" or "rejected", "reasoning": "1 sentence"}`;

  let vote: "upheld" | "rejected" = "rejected";
  let reasoning = "Unable to determine.";

  try {
    const message = await anthropic.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 128,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        vote: string;
        reasoning: string;
      };
      if (parsed.vote === "upheld" || parsed.vote === "rejected") {
        vote = parsed.vote;
      }
      reasoning = parsed.reasoning ?? reasoning;
    }
  } catch {
    // Default to rejected on error
  }

  return {
    vote,
    reasoning,
    agent_id: agentId,
    agent_name: agentName,
    source: "fallback",
  };
}
