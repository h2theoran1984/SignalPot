// POST /api/arena/grind — Automated arena grinding loop.
// Runs an agent against the Sparring Partner repeatedly until:
//   - The agent loses a match
//   - The credit budget is exhausted
//   - The max_rounds cap is hit
//   - Rate limits are reached
// Returns the full session summary with all match results.
export const maxDuration = 300; // 5 minutes max

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const grindSchema = z.object({
  agent_slug: z.string().min(3).max(64),
  capability: z.string().min(1).max(200),
  level: z.number().int().min(1).max(3).optional().default(1),
  max_rounds: z.number().int().min(1).max(50).optional().default(20),
  credit_limit: z.number().min(0).max(100).optional(), // USD — stop when spent exceeds this
  stop_on_loss: z.boolean().optional().default(true),
});

interface RoundResult {
  round: number;
  match_id: string;
  winner: string | null;
  reasoning: string | null;
  confidence: number | null;
  elo: { agent_elo: number; change: number } | null;
  cost: number;
  duration_ms: number;
}

export async function POST(request: NextRequest) {
  // Accept service-role key for admin/CLI access (used by autotune loop)
  const authHeader = request.headers.get("authorization");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isServiceRole =
    serviceRoleKey &&
    authHeader === `Bearer ${serviceRoleKey}`;

  const auth = isServiceRole ? null : await getAuthContext(request);
  if (!isServiceRole && !auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = grindSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { agent_slug, capability, level, max_rounds, credit_limit, stop_on_loss } = parsed.data;

  // Verify the agent exists
  const admin = createAdminClient();
  const { data: agent } = await admin
    .from("agents")
    .select("id, name, slug, rate_amount")
    .eq("slug", agent_slug)
    .eq("status", "active")
    .single();

  if (!agent) {
    return NextResponse.json({ error: `Agent '${agent_slug}' not found or inactive` }, { status: 404 });
  }

  // Check user's credit balance upfront (skip for service-role — unlimited budget)
  let effectiveBudget = Infinity;
  if (!isServiceRole && auth) {
    const { data: profile } = await admin
      .from("profiles")
      .select("credit_balance_millicents")
      .eq("id", auth.profileId)
      .single();

    const balanceUsd = (profile?.credit_balance_millicents as number ?? 0) / 100_000;
    effectiveBudget = credit_limit !== undefined ? Math.min(credit_limit, balanceUsd) : balanceUsd;
  }

  // Build the internal fight URL
  const baseUrl = request.url.replace(/\/api\/arena\/grind.*$/, "");
  const fightUrl = `${baseUrl}/api/arena/fight`;

  // Extract auth headers to forward
  const authHeaders: Record<string, string> = {};
  const authHeader = request.headers.get("authorization");
  if (authHeader) authHeaders["Authorization"] = authHeader;
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) authHeaders["Cookie"] = cookieHeader;

  const rounds: RoundResult[] = [];
  let totalSpent = 0;
  let stopped_reason = "max_rounds";

  for (let i = 0; i < max_rounds; i++) {
    // Budget check — estimate cost of next round
    const sparringCost = 0; // Sparring Partner is free
    const agentCost = Number(agent.rate_amount) || 0;
    const roundCost = agentCost + sparringCost;

    if (totalSpent + roundCost > effectiveBudget) {
      stopped_reason = "credit_limit";
      break;
    }

    // Call the fight endpoint
    let fightResult: Record<string, unknown>;
    const roundStart = Date.now();
    try {
      const res = await fetch(fightUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          agent_a_slug: agent_slug,
          agent_b_slug: "sparring-partner",
          capability,
          level,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
        stopped_reason = res.status === 429 ? "rate_limit" : `fight_error_${res.status}`;

        // If insufficient credits, stop gracefully
        if (res.status === 402) {
          stopped_reason = "insufficient_credits";
        }

        rounds.push({
          round: i + 1,
          match_id: "",
          winner: null,
          reasoning: (errBody.error as string) ?? `Fight failed with status ${res.status}`,
          confidence: null,
          elo: null,
          cost: 0,
          duration_ms: Date.now() - roundStart,
        });
        break;
      }

      fightResult = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      stopped_reason = "network_error";
      rounds.push({
        round: i + 1,
        match_id: "",
        winner: null,
        reasoning: err instanceof Error ? err.message : "Network error",
        confidence: null,
        elo: null,
        cost: 0,
        duration_ms: Date.now() - roundStart,
      });
      break;
    }

    const cost = fightResult.cost as { total: number } | undefined;
    const roundActualCost = cost?.total ?? 0;
    totalSpent += roundActualCost;

    const judgment = fightResult.judgment as {
      winner: string;
      reasoning: string;
      confidence: number;
    } | null;

    const elo = fightResult.elo as {
      agent_a_new: number;
      agent_a_change: number;
    } | null;

    rounds.push({
      round: i + 1,
      match_id: fightResult.match_id as string,
      winner: judgment?.winner ?? null,
      reasoning: judgment?.reasoning ?? null,
      confidence: judgment?.confidence ?? null,
      elo: elo ? { agent_elo: elo.agent_a_new, change: elo.agent_a_change } : null,
      cost: roundActualCost,
      duration_ms: Date.now() - roundStart,
    });

    // Stop on loss (agent is always "a", sparring partner is "b")
    if (stop_on_loss && judgment?.winner === "b") {
      stopped_reason = "loss";
      break;
    }

    // If both agents failed, stop
    if (fightResult.status === "failed") {
      stopped_reason = "match_failed";
      break;
    }
  }

  const wins = rounds.filter((r) => r.winner === "a").length;
  const losses = rounds.filter((r) => r.winner === "b").length;
  const ties = rounds.filter((r) => r.winner === "tie").length;
  const lastElo = rounds.findLast((r) => r.elo)?.elo;

  return NextResponse.json({
    agent: agent_slug,
    capability,
    level,
    rounds_played: rounds.length,
    record: { wins, losses, ties },
    total_spent_usd: Math.round(totalSpent * 1_000_000) / 1_000_000,
    credit_limit: credit_limit ?? null,
    stopped_reason,
    current_elo: lastElo?.agent_elo ?? null,
    rounds,
  });
}
