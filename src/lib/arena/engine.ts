// Arena match execution engine — calls two agents in parallel and records results.
// Mirrors the proxy route pattern (src/app/api/proxy/[slug]/route.ts) but for dual-agent calls.

import { createAdminClient } from "@/lib/supabase/admin";
import { wrapRequest, wrapResponse } from "@/lib/envelope";
import { validateOutput } from "@/lib/schema-validator";
import { inngest } from "@/lib/inngest/client";
import { resolveTemplate } from "@/lib/arena/rubric";
import type { Agent } from "@/lib/types";

interface AgentCallResult {
  response: Record<string, unknown>;
  durationMs: number;
  verified: boolean;
}

/**
 * Call a single agent's MCP endpoint (30s timeout, same as proxy route).
 * Creates a job record and returns the result.
 */
async function callAgent(
  admin: ReturnType<typeof createAdminClient>,
  agent: Agent,
  capability: string,
  prompt: Record<string, unknown>,
  matchId: string,
  side: "a" | "b"
): Promise<{ jobId: string; result: AgentCallResult } | { jobId: string; error: string }> {
  // Create job record
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      provider_agent_id: agent.id,
      requester_profile_id: null,
      requester_agent_id: null,
      job_type: "production",
      capability_used: capability,
      input_summary: prompt,
      status: "pending",
      cost: Number(agent.rate_amount) || 0,
      verified: false,
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return { jobId: "", error: `Failed to create job for agent ${side}` };
  }

  const jobId = job.id as string;

  // Build request envelope
  const requestEnvelope = wrapRequest({
    jobId,
    callerId: `arena:${matchId}`,
    providerSlug: agent.slug,
    capability,
    input: prompt,
  });

  await admin
    .from("jobs")
    .update({
      input_summary: { ...prompt, _envelope: requestEnvelope },
      status: "running",
    })
    .eq("id", jobId);

  // Call agent MCP endpoint
  if (!agent.mcp_endpoint) {
    await admin
      .from("jobs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", jobId);
    return { jobId, error: "Agent has no endpoint configured" };
  }

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(agent.mcp_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capability,
        input: prompt,
        job_id: jobId,
        _envelope: requestEnvelope,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Agent returned ${res.status}`);
    }

    const agentResponse = (await res.json()) as Record<string, unknown>;
    const durationMs = Date.now() - startTime;

    // Validate output
    const capSchemas = (agent.capability_schema as unknown as Array<Record<string, unknown>>) ?? [];
    const matchedCap = capSchemas.find(
      (c) => (c as { name: string }).name === capability
    );
    const outputSchema = (matchedCap?.outputSchema as Record<string, unknown>) ?? null;
    const validation = validateOutput(outputSchema, agentResponse);

    // Build response envelope and update job
    const responseEnvelope = wrapResponse({
      jobId,
      providerSlug: agent.slug,
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

    return {
      jobId,
      result: {
        response: agentResponse,
        durationMs,
        verified: validation.valid,
      },
    };
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
    return { jobId, error: message };
  }
}

/**
 * Execute an arena match — called by Inngest async function.
 * 1. Validates both agents are active and share the capability
 * 2. Calls both agents in parallel via Promise.allSettled
 * 3. Updates the match row with responses
 * 4. Transitions to voting or failed
 */
export async function executeMatch(matchId: string): Promise<void> {
  const admin = createAdminClient();

  // Fetch the match
  const { data: match, error: matchError } = await admin
    .from("arena_matches")
    .select("*")
    .eq("id", matchId)
    .single();

  if (matchError || !match) {
    console.error(`[arena] Match not found: ${matchId}`);
    return;
  }

  if (match.status !== "pending") {
    console.warn(`[arena] Match ${matchId} is not pending (status: ${match.status})`);
    return;
  }

  // Fetch both agents
  const { data: agentA } = await admin
    .from("agents")
    .select("*")
    .eq("id", match.agent_a_id)
    .single();

  const { data: agentB } = await admin
    .from("agents")
    .select("*")
    .eq("id", match.agent_b_id)
    .single();

  if (!agentA || !agentB) {
    await admin
      .from("arena_matches")
      .update({ status: "failed" })
      .eq("id", matchId);
    return;
  }

  // Resolve template if challenge has variable pools (anti-gaming)
  let actualPrompt = match.prompt as Record<string, unknown>;

  if (match.challenge_id) {
    const { data: challenge } = await admin
      .from("arena_challenges")
      .select("template_prompt, task_variables, prompt")
      .eq("id", match.challenge_id)
      .single();

    if (challenge?.template_prompt && challenge?.task_variables) {
      actualPrompt = resolveTemplate({
        template_prompt: challenge.template_prompt as Record<string, unknown> | null,
        task_variables: challenge.task_variables as Record<string, unknown[]> | null,
        prompt: challenge.prompt as Record<string, unknown>,
      });
    }
  }

  // Mark match as running + store resolved prompt
  const startedAt = new Date().toISOString();
  await admin
    .from("arena_matches")
    .update({
      status: "running",
      started_at: startedAt,
      resolved_prompt: actualPrompt,
    })
    .eq("id", matchId);

  // Call both agents in parallel (using resolved prompt, not template)
  const [resultA, resultB] = await Promise.allSettled([
    callAgent(admin, agentA as Agent, match.capability, actualPrompt, matchId, "a"),
    callAgent(admin, agentB as Agent, match.capability, actualPrompt, matchId, "b"),
  ]);

  // Process results
  const aResult = resultA.status === "fulfilled" ? resultA.value : { jobId: "", error: "Promise rejected" };
  const bResult = resultB.status === "fulfilled" ? resultB.value : { jobId: "", error: "Promise rejected" };

  const aSuccess = "result" in aResult;
  const bSuccess = "result" in bResult;

  // Build update object
  const update: Record<string, unknown> = {
    job_a_id: aResult.jobId || null,
    job_b_id: bResult.jobId || null,
  };

  if (aSuccess) {
    update.response_a = aResult.result.response;
    update.duration_a_ms = aResult.result.durationMs;
    update.verified_a = aResult.result.verified;
    update.cost_a = Number(agentA.rate_amount) || 0;
  }

  if (bSuccess) {
    update.response_b = bResult.result.response;
    update.duration_b_ms = bResult.result.durationMs;
    update.verified_b = bResult.result.verified;
    update.cost_b = Number(agentB.rate_amount) || 0;
  }

  if (aSuccess && bSuccess) {
    const matchType = (match.match_type as string) ?? "undercard";

    if (matchType === "championship") {
      // Championship → community voting (24h)
      const votingEndsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      update.status = "voting";
      update.voting_ends_at = votingEndsAt;
    } else {
      // Undercard → The Arbiter judges
      update.status = "judging";
    }
  } else if (aSuccess && !bSuccess) {
    // Only A succeeded — A wins by default
    update.status = "completed";
    update.winner = "a";
    update.completed_at = new Date().toISOString();
  } else if (!aSuccess && bSuccess) {
    // Only B succeeded — B wins by default
    update.status = "completed";
    update.winner = "b";
    update.completed_at = new Date().toISOString();
  } else {
    // Both failed
    update.status = "failed";
    update.completed_at = new Date().toISOString();
  }

  await admin
    .from("arena_matches")
    .update(update)
    .eq("id", matchId);

  // Fire judging event for undercard matches where both agents succeeded
  const matchType = (match.match_type as string) ?? "undercard";
  if (matchType === "undercard" && aSuccess && bSuccess) {
    await inngest.send({
      name: "arena/match.judging",
      data: { match_id: matchId },
    });
  }
}
