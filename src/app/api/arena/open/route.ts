import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/audit";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const maxDuration = 120;

/**
 * POST /api/arena/open — Open Arena. No login required.
 *
 * Accepts a prompt, runs it against all arena-eligible agents simultaneously,
 * and returns streamed results as they complete. Anyone can use this.
 *
 * Rate limited to 3 requests per minute per IP.
 */

const MAX_PROMPT_LENGTH = 2000;
const MAX_AGENTS = 6;
const AGENT_TIMEOUT_MS = 60_000;

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

export async function POST(request: NextRequest) {
  // Rate limit: 3 per minute per IP
  const ip = getClientIp(request);
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (redisUrl && redisToken) {
    const limiter = new Ratelimit({
      redis: new Redis({ url: redisUrl, token: redisToken }),
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

  // Fetch arena-eligible agents with endpoints
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

  // Build the A2A request payload
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

  // Fire all agents in parallel
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

      // Extract response from A2A format
      const rpcResult = data.result ?? data;
      const artifacts = rpcResult?.artifacts as Array<{ parts: Array<{ data?: Record<string, unknown> }> }> | undefined;
      const response = artifacts?.[0]?.parts?.[0]?.data ?? rpcResult;

      // Extract cost metadata
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

  // Rank by: completed first, then by quality heuristic (response length + speed)
  const ranked = [...results]
    .sort((a, b) => {
      if (a.status === "completed" && b.status !== "completed") return -1;
      if (b.status === "completed" && a.status !== "completed") return 1;
      // Among completed, faster wins ties
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
  });
}
