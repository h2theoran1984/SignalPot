// Arena match execution engine — calls two agents in parallel and records results.
// Mirrors the proxy route pattern (src/app/api/proxy/[slug]/route.ts) but for dual-agent calls.

import { createAdminClient } from "@/lib/supabase/admin";
import { wrapRequest, wrapResponse } from "@/lib/envelope";
import { validateOutput } from "@/lib/schema-validator";
import { inngest } from "@/lib/inngest/client";
import { resolveTemplate } from "@/lib/arena/rubric";
import { handleSparringRequest } from "@/lib/arena/sparring-partner";
import { dispatchPushNotifications } from "@/lib/a2a/handler";
import { assertSafeUrl } from "@/lib/ssrf";
import type { Agent } from "@/lib/types";

/** Championship voting window. */
const VOTING_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

const SPARRING_SLUG = "sparring-partner";

/**
 * Derive the A2A RPC endpoint from a stored mcp_endpoint URL.
 *
 * If the endpoint path ends with /mcp/tools (the MCP convention),
 * rewrite to /a2a/rpc on the same host. Otherwise, use the endpoint
 * as-is — it's already a direct RPC endpoint (e.g. /api/arena/underdog).
 */
async function deriveRpcEndpoint(mcpEndpoint: string): Promise<string> {
  await assertSafeUrl(mcpEndpoint);
  const url = new URL(mcpEndpoint);
  if (url.pathname.endsWith("/mcp/tools") || url.pathname.endsWith("/mcp")) {
    url.pathname = "/a2a/rpc";
  }
  return url.toString();
}

/**
 * Extract the actual response data from an A2A JSON-RPC result.
 * Digs into result.artifacts[0].parts[0].data if present,
 * otherwise returns the raw result.
 */
function extractA2AResponse(result: Record<string, unknown>): Record<string, unknown> {
  try {
    const artifacts = result.artifacts as Array<{ parts: Array<{ type: string; data?: Record<string, unknown> }> }>;
    if (artifacts?.[0]?.parts?.[0]?.data) {
      return artifacts[0].parts[0].data;
    }
  } catch {
    // Fall through to raw result
  }
  return result;
}

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

  const startTime = Date.now();

  try {
    let agentResponse: Record<string, unknown>;
    let providerCostUsd: number | null = null;

    // ── Sparring Partner: call directly, no network hop ──────────
    if (agent.slug === SPARRING_SLUG) {
      const sparringResult = await handleSparringRequest(capability, prompt);
      agentResponse = sparringResult.data;
      providerCostUsd = sparringResult.cost.api_cost_usd;
    }
    // ── External agent: call via A2A JSON-RPC 2.0 ────────────────
    else {
      if (!agent.mcp_endpoint) {
        await admin
          .from("jobs")
          .update({ status: "failed", completed_at: new Date().toISOString() })
          .eq("id", jobId);
        return { jobId, error: "Agent has no endpoint configured" };
      }

      const rpcEndpoint = await deriveRpcEndpoint(agent.mcp_endpoint);

      try {
        const res = await fetch(rpcEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: `arena-${matchId}-${side}-${Date.now()}`,
            method: "message/send",
            params: {
              message: {
                role: "user",
                parts: [{ type: "data", data: prompt }],
              },
              metadata: {
                capability_used: capability,
                job_id: jobId,
                _envelope: requestEnvelope,
              },
            },
          }),
        });


        if (!res.ok) {
          throw new Error(`Agent returned ${res.status}`);
        }

        const json = (await res.json()) as Record<string, unknown>;

        // Check for JSON-RPC error
        if (json.error) {
          const err = json.error as { message?: string };
          throw new Error(`Agent RPC error: ${err.message ?? JSON.stringify(json.error)}`);
        }

        // Extract the actual data from the A2A response wrapper
        const rpcResult = (json.result ?? json) as Record<string, unknown>;
        agentResponse = extractA2AResponse(rpcResult);

        // Extract provider-reported API cost from _meta (if present)
        const meta = rpcResult._meta as Record<string, unknown> | undefined;
        const pc = meta?.provider_cost as Record<string, unknown> | undefined;
        if (typeof pc?.api_cost_usd === "number") {
          providerCostUsd = pc.api_cost_usd;
        }
      } catch (fetchErr) {
        throw fetchErr;
      }
    }

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
        provider_cost: providerCostUsd,
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
    const message = err instanceof Error
      ? `${err.name}: ${err.message}`
      : "Agent unreachable";
    console.error(`[arena] Agent ${side} (${agent.slug}) failed after ${durationMs}ms:`, message);

    await admin
      .from("jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        output_summary: { _error: message },
      })
      .eq("id", jobId);

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
/**
 * Setup phase — load match, agents, resolve template, mark running.
 * Returns all context needed for agent calls.
 */
export async function setupMatch(matchId: string): Promise<{
  matchId: string;
  capability: string;
  prompt: Record<string, unknown>;
  matchType: string;
  creatorId: string | null;
  agentA: Agent;
  agentB: Agent;
} | null> {
  const admin = createAdminClient();

  const { data: match } = await admin
    .from("arena_matches")
    .select("id, status, agent_a_id, agent_b_id, capability, prompt, challenge_id, match_type, creator_id")
    .eq("id", matchId)
    .single();

  if (!match || match.status !== "pending") {
    console.warn("[arena] Match not found or not pending:", matchId);
    return null;
  }

  const AGENT_COLS = "id, name, slug, mcp_endpoint, rate_amount, capability_schema, status, owner_id";
  const { data: agentA } = await admin.from("agents").select(AGENT_COLS).eq("id", match.agent_a_id).single();
  const { data: agentB } = await admin.from("agents").select(AGENT_COLS).eq("id", match.agent_b_id).single();

  if (!agentA || !agentB) {
    await admin.from("arena_matches").update({ status: "failed" }).eq("id", matchId);
    return null;
  }

  // Resolve template
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

  await admin.from("arena_matches").update({
    status: "running",
    started_at: new Date().toISOString(),
    resolved_prompt: actualPrompt,
  }).eq("id", matchId);

  return {
    matchId,
    capability: match.capability as string,
    prompt: actualPrompt,
    matchType: (match.match_type as string) ?? "undercard",
    creatorId: match.creator_id as string | null,
    agentA: agentA as Agent,
    agentB: agentB as Agent,
  };
}

/**
 * Call a single agent and return the result (sync mode).
 * Used by the legacy fight endpoint.
 */
export async function callSingleAgent(
  agent: Agent,
  capability: string,
  prompt: Record<string, unknown>,
  matchId: string,
  side: "a" | "b"
): Promise<{ jobId: string; result: AgentCallResult } | { jobId: string; error: string }> {
  const admin = createAdminClient();
  return callAgent(admin, agent, capability, prompt, matchId, side);
}

/**
 * Fire-and-forget: send request to an agent with a callback URL.
 * The agent does its work and POSTs the result to the callback.
 * Returns the job ID immediately — no waiting for the response.
 */
export async function fireAgentCall(
  agent: Agent,
  capability: string,
  prompt: Record<string, unknown>,
  matchId: string,
  side: "a" | "b",
  callbackBaseUrl: string
): Promise<{ jobId: string }> {
  const admin = createAdminClient();

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
    return { jobId: "" };
  }

  const jobId = job.id as string;

  await admin.from("jobs").update({ status: "running" }).eq("id", jobId);

  const callbackUrl = `${callbackBaseUrl}/api/arena/matches/${matchId}/callback?side=${side}&job_id=${jobId}`;

  // Sparring Partner: call synchronously and post to callback
  if (agent.slug === "sparring-partner") {
    // Run in background — don't await
    handleSparringAndCallback(capability, prompt, jobId, callbackUrl, admin).catch((err) => {
      console.error(`[arena] Sparring partner fire-and-forget failed:`, err);
    });
    return { jobId };
  }

  // External agent: fire request with callback_url in metadata
  if (!agent.mcp_endpoint) {
    return { jobId };
  }

  const rpcEndpoint = await deriveRpcEndpoint(agent.mcp_endpoint);
  const requestEnvelope = wrapRequest({
    jobId,
    callerId: `arena:${matchId}`,
    providerSlug: agent.slug,
    capability,
    input: prompt,
  });

  // Fire and forget — don't await the response
  fireAndForget(rpcEndpoint, {
    jsonrpc: "2.0",
    id: `arena-${matchId}-${side}-${Date.now()}`,
    method: "message/send",
    params: {
      message: {
        role: "user",
        parts: [{ type: "data", data: prompt }],
      },
      metadata: {
        capability_used: capability,
        job_id: jobId,
        callback_url: callbackUrl,
        _envelope: requestEnvelope,
      },
    },
  }, jobId, callbackUrl, admin).catch((err) => {
    console.error(`[arena] Fire-and-forget failed for ${agent.slug}:`, err);
  });

  return { jobId };
}

/**
 * Fire request to agent, wait for response, then POST to callback.
 * Runs in background — no timeout pressure from the caller.
 * Also dispatches A2A push notifications on state transitions.
 */
async function fireAndForget(
  endpoint: string,
  body: Record<string, unknown>,
  jobId: string,
  callbackUrl: string,
  admin: ReturnType<typeof createAdminClient>
): Promise<void> {
  const startTime = Date.now();

  // Dispatch "working" push notification
  dispatchPushNotifications(jobId, "working", {
    kind: "task", id: jobId, contextId: jobId,
    status: { state: "working", timestamp: new Date().toISOString() },
  }).catch(() => {});

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const durationMs = Date.now() - startTime;

    if (!res.ok) {
      throw new Error(`Agent returned ${res.status}`);
    }

    const json = await res.json();
    const rpcResult = (json.result ?? json) as Record<string, unknown>;
    const agentResponse = extractA2AResponse(rpcResult);

    // Update job
    await admin.from("jobs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      verified: true,
    }).eq("id", jobId);

    // Dispatch "completed" push notification
    dispatchPushNotifications(jobId, "completed", {
      kind: "task", id: jobId, contextId: jobId,
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: rpcResult.artifacts ? [{ artifactId: jobId, parts: [{ kind: "data", data: agentResponse }] }] : undefined,
    }).catch(() => {});

    // POST to callback
    await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        result: rpcResult,
        duration_ms: durationMs,
      }),
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : "Agent unreachable";

    await admin.from("jobs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
    }).eq("id", jobId);

    // Dispatch "failed" push notification
    dispatchPushNotifications(jobId, "failed", {
      kind: "task", id: jobId, contextId: jobId,
      status: { state: "failed", message: { kind: "message", role: "agent", parts: [{ kind: "text", text: message }] }, timestamp: new Date().toISOString() },
    }).catch(() => {});

    // POST error to callback
    await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: message, duration_ms: durationMs }),
    });
  }
}

async function handleSparringAndCallback(
  capability: string,
  prompt: Record<string, unknown>,
  jobId: string,
  callbackUrl: string,
  admin: ReturnType<typeof createAdminClient>
): Promise<void> {
  const startTime = Date.now();

  try {
    const sparringResult = await handleSparringRequest(capability, prompt);
    const durationMs = Date.now() - startTime;

    await admin.from("jobs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      verified: true,
      provider_cost: sparringResult.cost.api_cost_usd,
    }).eq("id", jobId);

    await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        result: {
          artifacts: [{ parts: [{ type: "data", data: sparringResult.data }] }],
          _meta: { provider_cost: sparringResult.cost },
        },
        duration_ms: durationMs,
      }),
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : "Sparring partner failed";

    await admin.from("jobs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
    }).eq("id", jobId);

    await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: message, duration_ms: durationMs }),
    });
  }
}

/**
 * Finalize match — save results, determine winner or transition to judging/voting.
 */
export async function finalizeMatch(
  matchId: string,
  agentA: Agent,
  agentB: Agent,
  matchType: string,
  creatorId: string | null,
  resultA: { jobId: string; result: AgentCallResult } | { jobId: string; error: string },
  resultB: { jobId: string; result: AgentCallResult } | { jobId: string; error: string }
): Promise<{ status: string }> {
  const admin = createAdminClient();

  const aSuccess = "result" in resultA;
  const bSuccess = "result" in resultB;

  const update: Record<string, unknown> = {
    job_a_id: resultA.jobId || null,
    job_b_id: resultB.jobId || null,
  };

  if (aSuccess) {
    update.response_a = resultA.result.response;
    update.duration_a_ms = resultA.result.durationMs;
    update.verified_a = resultA.result.verified;
    update.cost_a = Number(agentA.rate_amount) || 0;
    // Look up actual API cost from job
    if (resultA.jobId) {
      const { data: jobA } = await admin.from("jobs").select("provider_cost").eq("id", resultA.jobId).single();
      update.api_cost_a = jobA?.provider_cost ?? 0;
    }
  } else {
    update.response_a = { _error: resultA.error, _agent: agentA.slug };
  }

  if (bSuccess) {
    update.response_b = resultB.result.response;
    update.duration_b_ms = resultB.result.durationMs;
    update.verified_b = resultB.result.verified;
    update.cost_b = Number(agentB.rate_amount) || 0;
    if (resultB.jobId) {
      const { data: jobB } = await admin.from("jobs").select("provider_cost").eq("id", resultB.jobId).single();
      update.api_cost_b = jobB?.provider_cost ?? 0;
    }
  } else {
    update.response_b = { _error: resultB.error, _agent: agentB.slug };
  }

  if (aSuccess && bSuccess) {
    if (matchType === "championship") {
      const votingEndsAt = new Date(Date.now() + VOTING_PERIOD_MS).toISOString();
      update.status = "voting";
      update.voting_ends_at = votingEndsAt;
    } else {
      update.status = "judging";
    }
  } else if (aSuccess && !bSuccess) {
    update.status = "completed";
    update.winner = "a";
    update.completed_at = new Date().toISOString();
  } else if (!aSuccess && bSuccess) {
    update.status = "completed";
    update.winner = "b";
    update.completed_at = new Date().toISOString();
  } else {
    update.status = "failed";
    update.completed_at = new Date().toISOString();
  }

  await admin.from("arena_matches").update(update).eq("id", matchId);

  // Billing for default wins / failures
  if (!aSuccess || !bSuccess) {
    const rawPct = parseInt(process.env.PLATFORM_FEE_PCT ?? "10", 10);
    const feePct = Number.isFinite(rawPct) && rawPct >= 0 && rawPct <= 100 ? rawPct : 10;

    for (const { agent, ok, cost } of [
      { agent: agentA, ok: aSuccess, cost: Number(agentA.rate_amount) || 0 },
      { agent: agentB, ok: bSuccess, cost: Number(agentB.rate_amount) || 0 },
    ]) {
      if (cost <= 0) continue;
      const costMillicents = Math.floor(cost * 100_000);

      if (ok && agent.owner_id && agent.owner_id !== creatorId) {
        const platformFee = Math.max(Math.floor((costMillicents * feePct) / 100), 100);
        const providerCut = costMillicents - platformFee;
        if (providerCut > 0) {
          await admin.rpc("add_credits", { p_user_id: agent.owner_id, p_amount_millicents: providerCut });
        }
      }

      if (!ok && creatorId) {
        await admin.rpc("add_credits", { p_user_id: creatorId, p_amount_millicents: costMillicents });
      }
    }
  }

  return { status: update.status as string };
}

/**
 * Legacy: Execute an arena match in a single call (for backward compat with /api/arena/fight).
 */
export async function executeMatch(matchId: string): Promise<void> {
  const admin = createAdminClient();

  // Fetch the match
  const { data: match, error: matchError } = await admin
    .from("arena_matches")
    .select("id, status, agent_a_id, agent_b_id, capability, prompt, challenge_id, match_type, creator_id")
    .eq("id", matchId)
    .single();

  if (matchError || !match) {
    console.error("[arena] Match not found");
    return;
  }

  if (match.status !== "pending") {
    console.warn("[arena] Match is not in pending state, skipping");
    return;
  }

  // Fetch both agents
  const AGENT_COLS = "id, name, slug, mcp_endpoint, rate_amount, capability_schema, status, owner_id";

  const { data: agentA } = await admin
    .from("agents")
    .select(AGENT_COLS)
    .eq("id", match.agent_a_id)
    .single();

  const { data: agentB } = await admin
    .from("agents")
    .select(AGENT_COLS)
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
  const aResult = resultA.status === "fulfilled"
    ? resultA.value
    : { jobId: "", error: `Promise rejected: ${resultA.reason}` };
  const bResult = resultB.status === "fulfilled"
    ? resultB.value
    : { jobId: "", error: `Promise rejected: ${resultB.reason}` };

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
  } else {
    // Store error in response field so it's visible in match detail + DB
    update.response_a = { _error: aResult.error, _agent: agentA.slug };
  }

  if (bSuccess) {
    update.response_b = bResult.result.response;
    update.duration_b_ms = bResult.result.durationMs;
    update.verified_b = bResult.result.verified;
    update.cost_b = Number(agentB.rate_amount) || 0;
  } else {
    // Store error in response field so it's visible in match detail + DB
    update.response_b = { _error: bResult.error, _agent: agentB.slug };
  }

  if (aSuccess && bSuccess) {
    const matchType = (match.match_type as string) ?? "undercard";

    if (matchType === "championship") {
      // Championship → community voting (24h)
      const votingEndsAt = new Date(Date.now() + VOTING_PERIOD_MS).toISOString();
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

  // Billing — credit providers for successful agents, refund creator for failed agents
  // (Only for default wins and double failures. Both-succeed billing happens after judging.)
  if (!aSuccess || !bSuccess) {
    const creatorId = match.creator_id as string | null;
    const rawPct = parseInt(process.env.PLATFORM_FEE_PCT ?? "10", 10);
    const feePct = Number.isFinite(rawPct) && rawPct >= 0 && rawPct <= 100 ? rawPct : 10;

    for (const { agent, ok, cost } of [
      { agent: agentA, ok: aSuccess, cost: Number(agentA.rate_amount) || 0 },
      { agent: agentB, ok: bSuccess, cost: Number(agentB.rate_amount) || 0 },
    ]) {
      if (cost <= 0) continue;
      const costMillicents = Math.floor(cost * 100_000);

      if (ok) {
        // Agent responded — credit provider, log platform fee
        // Skip crediting the fight creator (they paid the full cost; platform keeps its fee)
        const platformFee = Math.max(Math.floor((costMillicents * feePct) / 100), 100);
        const providerCut = costMillicents - platformFee;

        if (providerCut > 0 && agent.owner_id && agent.owner_id !== creatorId) {
          await admin.rpc("add_credits", {
            p_user_id: agent.owner_id,
            p_amount_millicents: providerCut,
          });
        }

        await admin.from("platform_revenue").insert({
          job_id: null,
          amount_millicents: platformFee,
        });
      } else if (creatorId) {
        // Agent failed — refund creator for this agent's portion
        await admin.rpc("add_credits", {
          p_user_id: creatorId,
          p_amount_millicents: costMillicents,
        });
      }
    }
  }

  // Fire judging event for undercard matches where both agents succeeded
  const matchType = (match.match_type as string) ?? "undercard";
  if (matchType === "undercard" && aSuccess && bSuccess) {
    await inngest.send({
      name: "arena/match.judging",
      data: { match_id: matchId },
    });
  }
}
