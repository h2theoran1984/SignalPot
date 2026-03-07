// Arena match execution engine — calls two agents in parallel and records results.
// Mirrors the proxy route pattern (src/app/api/proxy/[slug]/route.ts) but for dual-agent calls.

import { createAdminClient } from "@/lib/supabase/admin";
import { wrapRequest, wrapResponse } from "@/lib/envelope";
import { validateOutput } from "@/lib/schema-validator";
import { inngest } from "@/lib/inngest/client";
import { resolveTemplate } from "@/lib/arena/rubric";
import { handleSparringRequest } from "@/lib/arena/sparring-partner";
import type { Agent } from "@/lib/types";

/** How long to wait for an external agent response before aborting. */
const AGENT_CALL_TIMEOUT_MS = 30_000;
/** Championship voting window. */
const VOTING_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

const SPARRING_SLUG = "sparring-partner";

/** Private/internal IP patterns — block SSRF attempts. */
const BLOCKED_HOSTNAMES = ["localhost", "0.0.0.0", "[::1]"];
const PRIVATE_IP_PREFIXES = [
  "10.", "172.16.", "172.17.", "172.18.", "172.19.",
  "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.",
  "172.27.", "172.28.", "172.29.", "172.30.", "172.31.", "192.168.", "127.",
  "169.254.", "0.",
];

/**
 * Derive the A2A RPC endpoint from a stored mcp_endpoint URL.
 * Stored endpoints are typically /mcp/tools — the RPC endpoint
 * lives at /a2a/rpc on the same host.
 * Blocks SSRF to private/internal IPs.
 */
function deriveRpcEndpoint(mcpEndpoint: string): string {
  const url = new URL(mcpEndpoint);

  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Agent endpoints must use HTTPS");
  }

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    throw new Error("Agent endpoint resolves to a blocked address");
  }
  if (PRIVATE_IP_PREFIXES.some((p) => hostname.startsWith(p))) {
    throw new Error("Agent endpoint resolves to a private IP range");
  }
  if (hostname === "metadata.google.internal" || hostname.endsWith(".internal")) {
    throw new Error("Agent endpoint resolves to a cloud metadata address");
  }

  url.pathname = "/a2a/rpc";
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

    // ── Sparring Partner: call directly, no network hop ──────────
    if (agent.slug === SPARRING_SLUG) {
      agentResponse = await handleSparringRequest(capability, prompt);
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

      const rpcEndpoint = deriveRpcEndpoint(agent.mcp_endpoint);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AGENT_CALL_TIMEOUT_MS);

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
          signal: controller.signal,
        });

        clearTimeout(timeout);

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
      } finally {
        clearTimeout(timeout);
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
    .select("id, status, agent_a_id, agent_b_id, capability, prompt, challenge_id, match_type")
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
  const AGENT_COLS = "id, name, slug, mcp_endpoint, rate_amount, capability_schema, status";

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

  // Fire judging event for undercard matches where both agents succeeded
  const matchType = (match.match_type as string) ?? "undercard";
  if (matchType === "undercard" && aSuccess && bSuccess) {
    await inngest.send({
      name: "arena/match.judging",
      data: { match_id: matchId },
    });
  }
}
