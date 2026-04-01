import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest/client";
import { verifyCallbackToken } from "@/lib/arena/callback-auth";

/**
 * POST /api/arena/matches/[id]/callback?side=a|b&job_id=xxx
 *
 * Callback endpoint for async agent execution. The agent endpoint
 * calls this when it's done (however long that takes), and we fire
 * an Inngest event to resume the match execution flow.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: matchId } = await params;
  const side = request.nextUrl.searchParams.get("side") as "a" | "b" | null;
  const jobId = request.nextUrl.searchParams.get("job_id");
  const callbackSig = request.nextUrl.searchParams.get("cb_sig");

  if (!side || (side !== "a" && side !== "b") || !jobId) {
    return NextResponse.json({ error: "Missing or invalid side/job_id params" }, { status: 400 });
  }

  if (!verifyCallbackToken(matchId, side, jobId, callbackSig)) {
    return NextResponse.json({ error: "Invalid callback signature" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Verify match exists and is running
  const admin = createAdminClient();
  const { data: match } = await admin
    .from("arena_matches")
    .select("id, status, agent_a_id, agent_b_id")
    .eq("id", matchId)
    .single();

  if (!match || match.status !== "running") {
    return NextResponse.json({ error: "Match not found or not running" }, { status: 404 });
  }

  // Verify the callback job belongs to the expected side's agent.
  const expectedAgentId = side === "a" ? match.agent_a_id : match.agent_b_id;
  const { data: job } = await admin
    .from("jobs")
    .select("id, provider_agent_id")
    .eq("id", jobId)
    .single();

  if (!job || job.provider_agent_id !== expectedAgentId) {
    return NextResponse.json({ error: "job_id does not belong to this match side" }, { status: 403 });
  }

  // Extract result from A2A response format
  const rpcResult = (body.result ?? body) as Record<string, unknown>;
  const artifacts = rpcResult.artifacts as Array<{ parts: Array<{ data?: Record<string, unknown> }> }> | undefined;
  const response = artifacts?.[0]?.parts?.[0]?.data ?? rpcResult;

  const meta = rpcResult._meta as Record<string, unknown> | undefined;
  const providerCost = meta?.provider_cost as Record<string, unknown> | undefined;
  const providerCostUsd = (providerCost?.api_cost_usd as number) ?? null;

  const durationMs = (body.duration_ms as number) ?? 0;
  const error = (body.error as string) ?? null;

  // Fire Inngest event to resume match execution
  await inngest.send({
    name: "arena/agent.responded",
    data: {
      match_id: matchId,
      side,
      job_id: jobId,
      response: response as Record<string, unknown>,
      duration_ms: durationMs,
      verified: !error,
      provider_cost_usd: providerCostUsd,
      error,
    },
  });

  return NextResponse.json({ received: true, match_id: matchId, side });
}
