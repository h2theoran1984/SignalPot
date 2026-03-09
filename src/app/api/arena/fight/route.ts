// POST /api/arena/fight — Synchronous arena match endpoint.
// Bypasses Inngest and runs execute → judge → ELO in a single request.
// Used for testing and dev when Inngest isn't running.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, rateLimitResponse } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleSparringRequest } from "@/lib/arena/sparring-partner";
import { callArenaJudge } from "@/lib/arena/judge";
import { updateElo, getAgentElo } from "@/lib/arena/elo";
import { inferRubric, applyLevelModifiers, resolveTemplate } from "@/lib/arena/rubric";
import { generateSyntheticPrompt } from "@/lib/arena/synthetic";
import { isLevelUnlocked, LEVEL_CONFIGS, type ArenaLevel } from "@/lib/arena/levels";
import { fightSchema } from "@/lib/arena/validations";
import { checkArenaRateLimit } from "@/lib/rate-limit";
import { assertSafeUrl } from "@/lib/ssrf";

const AGENT_TIMEOUT = 30_000;

interface AgentResult {
  response: Record<string, unknown>;
  durationMs: number;
  verified: boolean;
}

/**
 * Derive the A2A RPC endpoint from a stored mcp_endpoint URL.
 * Stored endpoints are typically /mcp/tools — the RPC endpoint
 * lives at /a2a/rpc on the same host.
 */
function deriveRpcEndpoint(mcpEndpoint: string): string {
  assertSafeUrl(mcpEndpoint);
  const url = new URL(mcpEndpoint);
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

/**
 * Call an agent — handles both the Sparring Partner (internal)
 * and external agents via A2A JSON-RPC 2.0.
 */
async function callFighter(
  slug: string,
  mcpEndpoint: string | null,
  capability: string,
  prompt: Record<string, unknown>,
  level: ArenaLevel = 1
): Promise<AgentResult> {
  const start = Date.now();

  // Sparring Partner — call directly, no network hop
  if (slug === "sparring-partner") {
    const response = await handleSparringRequest(capability, prompt, level);
    return {
      response,
      durationMs: Date.now() - start,
      verified: true,
    };
  }

  // External agent — call via A2A JSON-RPC 2.0
  if (!mcpEndpoint) {
    throw new Error(`Agent ${slug} has no endpoint configured`);
  }

  const rpcEndpoint = deriveRpcEndpoint(mcpEndpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_TIMEOUT);

  try {
    const res = await fetch(rpcEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `fight-${slug}-${Date.now()}`,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "data", data: prompt }],
          },
          metadata: {
            capability_used: capability,
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
    const response = extractA2AResponse(rpcResult);

    return {
      response,
      durationMs: Date.now() - start,
      verified: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  // Auth check
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit — 5 fights/hour per user
  if (auth.profileId) {
    const rl = await checkArenaRateLimit(auth.profileId);
    if (!rl.success) return rateLimitResponse(rl.reset);
  }

  // Parse + validate body with Zod
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = fightSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { agent_a_slug, agent_b_slug, capability, prompt, challenge_id, level: rawLevel } = parsed.data;

  // Validate level (default 1, must be 1-3)
  const level: ArenaLevel = (rawLevel === 2 || rawLevel === 3) ? rawLevel : 1;

  const admin = createAdminClient();

  // Fetch both agents (explicit columns — no select(*))
  const AGENT_COLS = "id, name, slug, mcp_endpoint, rate_amount, owner_id";

  const { data: agentA } = await admin
    .from("agents")
    .select(AGENT_COLS)
    .eq("slug", agent_a_slug)
    .eq("status", "active")
    .single();

  const { data: agentB } = await admin
    .from("agents")
    .select(AGENT_COLS)
    .eq("slug", agent_b_slug)
    .eq("status", "active")
    .single();

  if (!agentA) return NextResponse.json({ error: `Agent '${agent_a_slug}' not found or inactive` }, { status: 404 });
  if (!agentB) return NextResponse.json({ error: `Agent '${agent_b_slug}' not found or inactive` }, { status: 404 });

  // Block placeholder agents (no endpoint) from arena fights — Sparring Partner is exempt (handled internally)
  if (agent_a_slug !== "sparring-partner" && !agentA.mcp_endpoint) {
    return NextResponse.json({ error: `Agent '${agent_a_slug}' has no endpoint — cannot fight` }, { status: 400 });
  }
  if (agent_b_slug !== "sparring-partner" && !agentB.mcp_endpoint) {
    return NextResponse.json({ error: `Agent '${agent_b_slug}' has no endpoint — cannot fight` }, { status: 400 });
  }

  // ELO gate — only applies when fighting the Sparring Partner at Level 2+
  const hasSparring = agent_a_slug === "sparring-partner" || agent_b_slug === "sparring-partner";
  if (hasSparring && level > 1) {
    const challengerSlug = agent_a_slug === "sparring-partner" ? agent_b_slug : agent_a_slug;
    const challengerId = agent_a_slug === "sparring-partner" ? (agentB.id as string) : (agentA.id as string);
    const challengerElo = await getAgentElo(challengerId, capability);

    if (!isLevelUnlocked(challengerElo, level)) {
      const required = LEVEL_CONFIGS[level].eloThreshold;
      return NextResponse.json(
        {
          error: `ELO too low for ${LEVEL_CONFIGS[level].label}`,
          detail: `${challengerSlug} has ${challengerElo} ELO in ${capability} — needs ${required} to unlock Level ${level}`,
          current_elo: challengerElo,
          required_elo: required,
        },
        { status: 403 }
      );
    }
  }

  // Billing — deduct total fight cost upfront before calling agents
  const costA = Number(agentA.rate_amount) || 0;
  const costB = Number(agentB.rate_amount) || 0;
  const totalCost = costA + costB;

  if (totalCost > 0) {
    const totalMillicents = Math.floor(totalCost * 100_000);
    const { error: paymentError } = await admin.rpc("settle_user_payment", {
      p_profile_id: auth.profileId,
      p_amount_millicents: totalMillicents,
    });

    if (paymentError) {
      const msg = paymentError.message ?? "";
      if (msg.includes("INSUFFICIENT_BALANCE")) {
        return NextResponse.json(
          {
            error: "Insufficient credits for arena fight",
            total_cost: totalCost,
            cost_a: costA,
            cost_b: costB,
            hint: "Top up at /dashboard",
          },
          { status: 402 }
        );
      }
      return NextResponse.json({ error: "Payment failed" }, { status: 500 });
    }
  }

  // Resolve the prompt — generate synthetic data if none provided
  let actualPrompt: Record<string, unknown>;
  if (prompt) {
    actualPrompt = prompt;
  } else {
    const synthetic = generateSyntheticPrompt(capability);
    actualPrompt = synthetic.prompt;
  }

  if (challenge_id) {
    const { data: challenge } = await admin
      .from("arena_challenges")
      .select("template_prompt, task_variables, prompt")
      .eq("id", challenge_id)
      .single();

    if (challenge?.template_prompt && challenge?.task_variables) {
      actualPrompt = resolveTemplate({
        template_prompt: challenge.template_prompt as Record<string, unknown> | null,
        task_variables: challenge.task_variables as Record<string, unknown[]> | null,
        prompt: challenge.prompt as Record<string, unknown>,
      });
    } else if (challenge?.prompt) {
      actualPrompt = challenge.prompt as Record<string, unknown>;
    }
  }

  // Create the match record
  const { data: match, error: matchError } = await admin
    .from("arena_matches")
    .insert({
      creator_id: auth.profileId ?? null,
      agent_a_id: agentA.id,
      agent_b_id: agentB.id,
      capability,
      prompt: actualPrompt,
      resolved_prompt: actualPrompt,
      level: hasSparring ? level : null,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (matchError || !match) {
    console.error("[arena-fight] Match insert failed");
    return NextResponse.json({ error: "Failed to create match" }, { status: 500 });
  }

  const matchId = match.id as string;

  // === FIGHT! ===
  // Call both agents in parallel
  const [resultA, resultB] = await Promise.allSettled([
    callFighter(agent_a_slug, agentA.mcp_endpoint as string | null, capability, actualPrompt, level),
    callFighter(agent_b_slug, agentB.mcp_endpoint as string | null, capability, actualPrompt, level),
  ]);

  const aOk = resultA.status === "fulfilled";
  const bOk = resultB.status === "fulfilled";
  const aData = aOk ? resultA.value : null;
  const bData = bOk ? resultB.value : null;
  const aError = !aOk ? (resultA.reason as Error).message : null;
  const bError = !bOk ? (resultB.reason as Error).message : null;

  // Update match with responses
  const matchUpdate: Record<string, unknown> = {};
  if (aData) {
    matchUpdate.response_a = aData.response;
    matchUpdate.duration_a_ms = aData.durationMs;
    matchUpdate.verified_a = aData.verified;
    matchUpdate.cost_a = Number(agentA.rate_amount) || 0;
  }
  if (bData) {
    matchUpdate.response_b = bData.response;
    matchUpdate.duration_b_ms = bData.durationMs;
    matchUpdate.verified_b = bData.verified;
    matchUpdate.cost_b = Number(agentB.rate_amount) || 0;
  }

  // === JUDGE ===
  let judgment = null;
  let eloResult = null;

  if (aOk && bOk) {
    // Both succeeded — judge the match
    matchUpdate.status = "judging";
    await admin.from("arena_matches").update(matchUpdate).eq("id", matchId);

    const baseRubric = inferRubric(capability);
    const rubric = applyLevelModifiers(baseRubric, level);

    judgment = await callArenaJudge({
      matchId,
      capability,
      promptText: null,
      prompt: actualPrompt,
      agentAName: agentA.name as string,
      agentBName: agentB.name as string,
      responseA: aData!.response,
      responseB: bData!.response,
      durationAMs: aData!.durationMs,
      durationBMs: bData!.durationMs,
      verifiedA: aData!.verified,
      verifiedB: bData!.verified,
      rubric,
      costACents: Math.round(Number(agentA.rate_amount ?? 0) * 100),
      costBCents: Math.round(Number(agentB.rate_amount ?? 0) * 100),
      level,
    });

    // Finalize match
    await admin.from("arena_matches").update({
      status: "completed",
      winner: judgment.winner,
      judgment_reasoning: judgment.reasoning,
      judgment_confidence: judgment.confidence,
      judgment_source: judgment.source,
      judgment_breakdown: judgment.breakdown ?? null,
      completed_at: new Date().toISOString(),
    }).eq("id", matchId);

    // Update ELO
    eloResult = await updateElo(
      agentA.id as string,
      agentB.id as string,
      capability,
      judgment.winner
    );
  } else if (aOk && !bOk) {
    matchUpdate.status = "completed";
    matchUpdate.winner = "a";
    matchUpdate.judgment_reasoning = `Agent B (${agent_b_slug}) failed to respond`;
    matchUpdate.completed_at = new Date().toISOString();
    await admin.from("arena_matches").update(matchUpdate).eq("id", matchId);

    eloResult = await updateElo(agentA.id as string, agentB.id as string, capability, "a");
  } else if (!aOk && bOk) {
    matchUpdate.status = "completed";
    matchUpdate.winner = "b";
    matchUpdate.judgment_reasoning = `Agent A (${agent_a_slug}) failed to respond`;
    matchUpdate.completed_at = new Date().toISOString();
    await admin.from("arena_matches").update(matchUpdate).eq("id", matchId);

    eloResult = await updateElo(agentA.id as string, agentB.id as string, capability, "b");
  } else {
    matchUpdate.status = "failed";
    matchUpdate.completed_at = new Date().toISOString();
    await admin.from("arena_matches").update(matchUpdate).eq("id", matchId);
  }

  // Billing — credit providers for successful calls, refund creator for failed agents
  if (totalCost > 0) {
    const rawPct = parseInt(process.env.PLATFORM_FEE_PCT ?? "10", 10);
    const feePct = Number.isFinite(rawPct) && rawPct >= 0 && rawPct <= 100 ? rawPct : 10;

    for (const { agent, ok, cost } of [
      { agent: agentA, ok: aOk, cost: costA },
      { agent: agentB, ok: bOk, cost: costB },
    ]) {
      if (cost <= 0) continue;
      const costMillicents = Math.floor(cost * 100_000);

      if (ok) {
        // Agent responded — credit provider, log platform fee
        const platformFee = Math.max(Math.floor((costMillicents * feePct) / 100), 100);
        const providerCut = costMillicents - platformFee;

        if (providerCut > 0) {
          await admin.rpc("add_credits", {
            p_user_id: agent.owner_id,
            p_amount_millicents: providerCut,
          });
        }

        await admin.from("platform_revenue").insert({
          job_id: null,
          amount_millicents: platformFee,
        });
      } else {
        // Agent failed — refund creator for this agent's portion
        await admin.rpc("add_credits", {
          p_user_id: auth.profileId,
          p_amount_millicents: costMillicents,
        });
      }
    }
  }

  return NextResponse.json({
    match_id: matchId,
    status: aOk && bOk ? "completed" : (!aOk && !bOk) ? "failed" : "completed",
    agent_a: {
      slug: agent_a_slug,
      responded: aOk,
      duration_ms: aData?.durationMs ?? null,
      response: aData?.response ?? null,
      error: aOk ? null : "Agent failed to respond",
    },
    agent_b: {
      slug: agent_b_slug,
      responded: bOk,
      duration_ms: bData?.durationMs ?? null,
      response: bData?.response ?? null,
      error: bOk ? null : "Agent failed to respond",
    },
    judgment: judgment ? {
      winner: judgment.winner,
      reasoning: judgment.reasoning,
      confidence: judgment.confidence,
      source: judgment.source,
    } : null,
    cost: { total: totalCost, agent_a: costA, agent_b: costB },
    level: hasSparring ? level : null,
    elo: eloResult,
    prompt: actualPrompt,
    view_url: `/arena/${matchId}`,
  });
}
