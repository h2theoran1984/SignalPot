import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/audit";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const maxDuration = 120;

/**
 * POST /api/arena/open — Open Arena. First hit free, then credits.
 *
 * Accepts a prompt, runs it against all arena-eligible agents simultaneously.
 * First run per IP is free. After that, requires a session_token with credits.
 *
 * Rate limited to 3 requests per minute per IP.
 */

const MAX_PROMPT_LENGTH = 2000;
const MAX_AGENTS = 6;
const AGENT_TIMEOUT_MS = 60_000;
const COST_PER_RUN_MILLICENTS = 1500; // $0.015 per run (covers ~$0.15 API cost with margin)

interface AgentResult {
  slug: string;
  name: string;
  model_id: string;
  status: "pending" | "running" | "completed" | "failed" | "timeout";
  response: Record<string, unknown> | null;
  duration_ms: number | null;
  api_cost: number | null;
  error: string | null;
}

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const redis = getRedis();

  // ── Rate limit: 3 per minute per IP ──
  if (redis) {
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, "1 m"),
      prefix: "sp:open-arena",
    });
    const { success } = await limiter.limit(ip);
    if (!success) {
      return NextResponse.json(
        { error: "Rate limited — try again in a minute" },
        { status: 429 }
      );
    }
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const prompt = (body.prompt as string)?.trim();
  const sessionToken = (body.session_token as string) ?? null;

  if (!prompt || prompt.length < 10) {
    return NextResponse.json(
      { error: "Prompt must be at least 10 characters" },
      { status: 400 }
    );
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Prompt must be under ${MAX_PROMPT_LENGTH} characters` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // ── Credit gate: first run free, then pay ──
  let isFreeRun = false;
  let creditBalance: number | null = null;

  if (sessionToken) {
    // Paid run — verify session and deduct credits
    const { data: session } = await admin
      .from("anonymous_sessions")
      .select("id, credit_balance_millicents, expires_at")
      .eq("session_token", sessionToken)
      .single();

    if (!session) {
      return NextResponse.json(
        { error: "Invalid session token", code: "INVALID_SESSION" },
        { status: 401 }
      );
    }

    if (new Date(session.expires_at as string) < new Date()) {
      return NextResponse.json(
        { error: "Session expired — purchase new credits", code: "SESSION_EXPIRED" },
        { status: 401 }
      );
    }

    const balance = session.credit_balance_millicents as number;
    if (balance < COST_PER_RUN_MILLICENTS) {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          code: "INSUFFICIENT_CREDITS",
          balance_millicents: balance,
          cost_millicents: COST_PER_RUN_MILLICENTS,
        },
        { status: 402 }
      );
    }

    // Deduct credits atomically
    const { error: deductError } = await admin.rpc("deduct_anon_credits", {
      p_session_token: sessionToken,
      p_amount: COST_PER_RUN_MILLICENTS,
    });

    if (deductError) {
      // Fallback: manual deduction if RPC doesn't exist
      await admin
        .from("anonymous_sessions")
        .update({
          credit_balance_millicents: balance - COST_PER_RUN_MILLICENTS,
        })
        .eq("session_token", sessionToken)
        .gte("credit_balance_millicents", COST_PER_RUN_MILLICENTS);
    }

    creditBalance = balance - COST_PER_RUN_MILLICENTS;
  } else {
    // Check if this IP has used their free run
    const freeRunKey = `sp:open-arena:free:${ip}`;

    if (redis) {
      const used = await redis.get(freeRunKey);
      if (used) {
        return NextResponse.json(
          {
            error: "Free run used — add credits to continue",
            code: "FREE_RUN_USED",
          },
          { status: 402 }
        );
      }
    }

    isFreeRun = true;
  }

  // ── Fetch arena-eligible agents ──
  const { data: agents } = await admin
    .from("agents")
    .select("id, name, slug, model_id, mcp_endpoint, system_prompt, capability_schema")
    .eq("status", "active")
    .eq("arena_eligible", true)
    .eq("visibility", "public")
    .not("mcp_endpoint", "is", null)
    .order("total_external_calls", { ascending: false })
    .limit(MAX_AGENTS);

  if (!agents || agents.length === 0) {
    return NextResponse.json({ error: "No agents available" }, { status: 503 });
  }

  // ── Mark free run as used (after confirming agents exist) ──
  if (isFreeRun && redis) {
    // Expire after 24 hours — they get a new free run tomorrow
    await redis.set(`sp:open-arena:free:${ip}`, "1", { ex: 86400 });
  }

  // ── Build A2A payload and fire all agents ──
  const a2aPayload = {
    jsonrpc: "2.0",
    method: "message/send",
    params: {
      message: {
        parts: [{ type: "data", data: { text: prompt } }],
      },
      metadata: {
        capability_used: "analyze",
        source: "open-arena",
      },
    },
  };

  const results: AgentResult[] = agents.map((a) => ({
    slug: a.slug as string,
    name: a.name as string,
    model_id: (a.model_id as string) ?? "unknown",
    status: "running" as const,
    response: null,
    duration_ms: null,
    api_cost: null,
    error: null,
  }));

  const promises = agents.map(async (agent, i) => {
    const endpoint = agent.mcp_endpoint as string;
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signalpot-internal": process.env.INTERNAL_DISPATCH_KEY ?? "",
        },
        body: JSON.stringify({ ...a2aPayload, id: `open-${agent.slug}-${Date.now()}` }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const elapsed = Date.now() - startTime;

      if (!res.ok) {
        results[i].status = "failed";
        results[i].duration_ms = elapsed;
        results[i].error = `HTTP ${res.status}`;
        return;
      }

      const data = await res.json();
      const rpcResult = data.result ?? data;
      const artifacts = rpcResult?.artifacts as Array<{ parts: Array<{ data?: Record<string, unknown> }> }> | undefined;
      const response = artifacts?.[0]?.parts?.[0]?.data ?? rpcResult;
      const meta = rpcResult?._meta as Record<string, unknown> | undefined;
      const providerCost = meta?.provider_cost as Record<string, unknown> | undefined;

      results[i].status = "completed";
      results[i].response = response as Record<string, unknown>;
      results[i].duration_ms = elapsed;
      results[i].api_cost = (providerCost?.api_cost_usd as number) ?? null;
    } catch (err) {
      const elapsed = Date.now() - startTime;
      results[i].duration_ms = elapsed;

      if (err instanceof DOMException && err.name === "AbortError") {
        results[i].status = "timeout";
        results[i].error = "Agent timed out (60s)";
      } else {
        results[i].status = "failed";
        results[i].error = err instanceof Error ? err.message : "Unknown error";
      }
    }
  });

  await Promise.allSettled(promises);

  const ranked = [...results].sort((a, b) => {
    if (a.status === "completed" && b.status !== "completed") return -1;
    if (b.status === "completed" && a.status !== "completed") return 1;
    return (a.duration_ms ?? Infinity) - (b.duration_ms ?? Infinity);
  });

  return NextResponse.json({
    prompt,
    agents_count: agents.length,
    results: ranked,
    completed: ranked.filter((r) => r.status === "completed").length,
    fastest: ranked.find((r) => r.status === "completed")?.slug ?? null,
    cheapest: ranked
      .filter((r) => r.status === "completed" && r.api_cost != null && r.api_cost > 0)
      .sort((a, b) => (a.api_cost ?? 0) - (b.api_cost ?? 0))[0]?.slug ?? null,
    credits: {
      free_run: isFreeRun,
      balance_millicents: creditBalance,
      cost_per_run_millicents: COST_PER_RUN_MILLICENTS,
    },
  });
}
