// POST /api/arena/fight — Synchronous arena match endpoint.
// Bypasses Inngest and runs execute → judge → ELO in a single request.
// Used for testing and dev when Inngest isn't running.
export const maxDuration = 60;

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
import { getArenaLimitForPlan, type Plan } from "@/lib/plans";
import { assertSafeUrl } from "@/lib/ssrf";
import { verifyArenaAdminAuth } from "@/lib/arena/admin-auth";
import { getActiveProcessors, getProcessorById } from "@/lib/arena/processor-manager";

const AGENT_TIMEOUT = 45_000; // 45s — Opus-level prompts at L3/L4 can be slow

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
  // Auth check — accept dedicated arena admin secret for internal/CLI access (used by autotune loop)
  const isServiceRole = await verifyArenaAdminAuth(request);

  const auth = isServiceRole ? null : await getAuthContext(request);
  if (!isServiceRole && !auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // For service-role calls, resolve a system profile ID for creator_id (NOT NULL column)
  let effectiveProfileId = auth?.profileId ?? null;
  if (isServiceRole && !effectiveProfileId) {
    const adminLookup = createAdminClient();
    const { data: sysProfile } = await adminLookup
      .from("profiles")
      .select("id")
      .limit(1)
      .single();
    effectiveProfileId = sysProfile?.id as string ?? null;
  }

  // Rate limit — tiered by plan (free: 5/hr, pro: 25/hr, team: 100/hr)
  // Skip rate limiting for service-role (admin) access
  if (auth?.profileId) {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("plan")
      .eq("id", auth.profileId)
      .single();
    const plan = (profile?.plan as Plan) ?? "free";
    const arenaLimit = getArenaLimitForPlan(plan);
    const rl = await checkArenaRateLimit(auth.profileId, arenaLimit);
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

  // Validate level (default 1, must be 1-4)
  const level: ArenaLevel = (rawLevel && rawLevel >= 2 && rawLevel <= 4) ? rawLevel as ArenaLevel : 1;

  const admin = createAdminClient();

  // Fetch both agents (explicit columns — no select(*))
  const AGENT_COLS = "id, name, slug, mcp_endpoint, rate_amount, owner_id, capability_schema";

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

  // Billing — deduct agent costs + arena match fee upfront
  const costA = Number(agentA.rate_amount) || 0;
  const costB = Number(agentB.rate_amount) || 0;
  const matchFee = hasSparring ? LEVEL_CONFIGS[level].matchFeeUsd : 0;
  const totalCost = costA + costB + matchFee;

  if (totalCost > 0 && effectiveProfileId && !isServiceRole) {
    const totalMillicents = Math.floor(totalCost * 100_000);
    const { error: paymentError } = await admin.rpc("settle_user_payment", {
      p_profile_id: effectiveProfileId,
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
            match_fee: matchFee,
            hint: "Top up at /dashboard",
          },
          { status: 402 }
        );
      }
      return NextResponse.json({ error: "Payment failed" }, { status: 500 });
    }
  }

  // Resolve the prompt — generate synthetic data if none provided (uses Claude Haiku)
  let actualPrompt: Record<string, unknown>;
  if (prompt) {
    actualPrompt = prompt;
  } else {
    // Find the challenger's input schema for this capability
    const challengerCaps = (
      agent_a_slug === "sparring-partner"
        ? (agentB as Record<string, unknown>)
        : (agentA as Record<string, unknown>)
    ).capability_schema as Array<{ name: string; input_schema?: Record<string, unknown> }> | undefined;
    const capDef = challengerCaps?.find((c) => c.name === capability);
    const inputSchema = capDef?.input_schema as Record<string, unknown> | undefined;

    const synthetic = await generateSyntheticPrompt(capability, inputSchema);
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
      creator_id: effectiveProfileId,
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

  // === APPLY PROCESSORS ===
  // Each agent may have different active processors — apply them to enrich the prompt
  const processorsA = await getActiveProcessors(agentA.id as string, capability);
  const processorsB = await getActiveProcessors(agentB.id as string, capability);

  let promptForA: Record<string, unknown> = actualPrompt;
  for (const pid of processorsA) {
    const proc = getProcessorById(pid);
    if (proc) promptForA = proc.preProcess(promptForA);
  }

  let promptForB: Record<string, unknown> = actualPrompt;
  for (const pid of processorsB) {
    const proc = getProcessorById(pid);
    if (proc) promptForB = proc.preProcess(promptForB);
  }

  // === FIGHT! ===
  // Call both agents in parallel (each may get a processor-enriched prompt)
  const [resultA, resultB] = await Promise.allSettled([
    callFighter(agent_a_slug, agentA.mcp_endpoint as string | null, capability, promptForA, level),
    callFighter(agent_b_slug, agentB.mcp_endpoint as string | null, capability, promptForB, level),
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

    // Collect verification hints from all active processors (union of both agents)
    const allProcessorIds = new Set([...processorsA, ...processorsB]);
    const verificationHints: string[] = [];
    for (const pid of Array.from(allProcessorIds)) {
      const proc = getProcessorById(pid);
      if (proc) {
        const hint = proc.buildVerification(actualPrompt, aData!.response, bData!.response);
        if (hint) verificationHints.push(hint);
      }
    }

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
      verificationHints: verificationHints.length > 0 ? verificationHints : undefined,
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
      judgment.winner,
      agent_a_slug,
      agent_b_slug
    );
  } else if (aOk && !bOk) {
    // Agent B failed (timeout/error) — mark as failed, no ELO change for either side.
    // This prevents gaming via intentionally broken agents and ensures symmetric handling.
    matchUpdate.status = "failed";
    matchUpdate.judgment_reasoning = agent_b_slug === "sparring-partner"
      ? `Sparring Partner failed unexpectedly: ${bError}. No ELO change.`
      : `Agent B (${agent_b_slug}) failed to respond: ${bError}. No ELO change.`;
    matchUpdate.completed_at = new Date().toISOString();
    await admin.from("arena_matches").update(matchUpdate).eq("id", matchId);
  } else if (!aOk && bOk) {
    // Agent A failed (timeout/error) — mark as failed, no ELO change for either side.
    matchUpdate.status = "failed";
    matchUpdate.judgment_reasoning = `Agent A (${agent_a_slug}) failed to respond: ${aError}. No ELO change.`;
    matchUpdate.completed_at = new Date().toISOString();
    await admin.from("arena_matches").update(matchUpdate).eq("id", matchId);
  } else {
    matchUpdate.status = "failed";
    matchUpdate.completed_at = new Date().toISOString();
    await admin.from("arena_matches").update(matchUpdate).eq("id", matchId);
  }

  // Billing — record match fee as platform revenue (non-refundable, covers judge + sparring costs)
  if (matchFee > 0) {
    const matchFeeMillicents = Math.floor(matchFee * 100_000);
    await admin.from("platform_revenue").insert({
      job_id: null,
      amount_millicents: matchFeeMillicents,
    });
  }

  // Billing — credit providers for successful calls, refund creator for failed agents
  const billingErrors: Array<{ op: string; agent: string; amount: number; error: string }> = [];
  if (totalCost > 0) {
    const rawPct = parseInt(process.env.PLATFORM_FEE_PCT ?? "10", 10);
    const feePct = Number.isFinite(rawPct) && rawPct >= 0 && rawPct <= 100 ? rawPct : 10;

    for (const { agent, slug, ok, cost } of [
      { agent: agentA, slug: agent_a_slug, ok: aOk, cost: costA },
      { agent: agentB, slug: agent_b_slug, ok: bOk, cost: costB },
    ]) {
      if (cost <= 0) continue;
      const costMillicents = Math.floor(cost * 100_000);

      if (ok) {
        // Agent responded — credit provider, log platform fee
        // Skip crediting the fight creator (they paid the full cost; platform keeps its fee)
        const platformFee = Math.max(Math.floor((costMillicents * feePct) / 100), 100);
        const providerCut = costMillicents - platformFee;

        if (providerCut > 0 && agent.owner_id && agent.owner_id !== effectiveProfileId) {
          const { error: creditError } = await admin.rpc("add_credits", {
            p_user_id: agent.owner_id,
            p_amount_millicents: providerCut,
          });
          if (creditError) {
            console.error(`[arena-fight] BILLING ERROR: Failed to credit provider ${agent.owner_id} for agent ${slug}, match ${matchId}, amount ${providerCut} millicents:`, creditError.message);
            billingErrors.push({ op: "provider_credit", agent: slug, amount: providerCut, error: creditError.message });
          }
        }

        await admin.from("platform_revenue").insert({
          job_id: null,
          amount_millicents: platformFee,
        });
      } else {
        // Agent failed — refund creator for this agent's portion (regardless of auth method)
        if (effectiveProfileId) {
          const { error: refundError } = await admin.rpc("add_credits", {
            p_user_id: effectiveProfileId,
            p_amount_millicents: costMillicents,
          });
          if (refundError) {
            console.error(`[arena-fight] BILLING ERROR: Failed to refund creator ${effectiveProfileId} for agent ${slug}, match ${matchId}, amount ${costMillicents} millicents:`, refundError.message);
            billingErrors.push({ op: "creator_refund", agent: slug, amount: costMillicents, error: refundError.message });
          }
        }
      }
    }
  }

  // Persist billing errors to the match record for audit trail
  if (billingErrors.length > 0) {
    await admin.from("arena_matches").update({
      billing_notes: billingErrors,
    }).eq("id", matchId);
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
    cost: { total: totalCost, agent_a: costA, agent_b: costB, match_fee: matchFee },
    level: hasSparring ? level : null,
    elo: eloResult,
    prompt: actualPrompt,
    view_url: `/arena/${matchId}`,
  });
}
