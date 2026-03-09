import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/arena/debug-fetch — Temporary diagnostic endpoint.
 * Simulates the FULL callAgent flow including DB operations + fetch,
 * to isolate where the Inngest arena execution fails.
 * DELETE THIS AFTER DEBUGGING.
 */
export async function GET() {
  const steps: { step: string; durationMs: number; error?: string }[] = [];
  const overall = Date.now();

  try {
    // Step 1: Create Supabase admin client
    let t = Date.now();
    const admin = createAdminClient();
    steps.push({ step: "1-create-admin-client", durationMs: Date.now() - t });

    // Step 2: Fetch agent from DB (like engine does)
    t = Date.now();
    const { data: agent, error: agentErr } = await admin
      .from("agents")
      .select("id, name, slug, mcp_endpoint, rate_amount, capability_schema, status, owner_id")
      .eq("slug", "the-next-step")
      .single();
    steps.push({
      step: "2-fetch-agent",
      durationMs: Date.now() - t,
      error: agentErr?.message,
    });

    if (!agent) {
      return NextResponse.json({ steps, error: "Agent not found", agentErr });
    }

    // Step 3: Create a test job
    t = Date.now();
    const { data: job, error: jobErr } = await admin
      .from("jobs")
      .insert({
        provider_agent_id: agent.id,
        requester_profile_id: null,
        requester_agent_id: null,
        job_type: "production",
        capability_used: "signalpot/meeting-summary@v1",
        input_summary: { text: "Debug test" },
        status: "pending",
        cost: 0,
        verified: false,
      })
      .select("id")
      .single();
    steps.push({
      step: "3-create-job",
      durationMs: Date.now() - t,
      error: jobErr?.message,
    });

    const jobId = job?.id ?? "no-job";

    // Step 4: Derive endpoint and fetch
    t = Date.now();
    const endpoint = agent.mcp_endpoint
      ? new URL(agent.mcp_endpoint).origin + "/a2a/rpc"
      : "NO_ENDPOINT";
    steps.push({ step: "4-derive-endpoint", durationMs: Date.now() - t });

    // Step 5: The actual fetch (this is where engine would call the agent)
    t = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `debug-full-${Date.now()}`,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "data", data: { text: "Meeting: Debug test. Alice: Ship it." } }],
          },
          metadata: {
            capability_used: "signalpot/meeting-summary@v1",
            job_id: jobId,
          },
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    steps.push({ step: "5-fetch-agent", durationMs: Date.now() - t });

    // Step 6: Parse response
    t = Date.now();
    const json = await res.json();
    const hasError = !!json.error;
    const hasResult = !!json.result;
    steps.push({
      step: "6-parse-response",
      durationMs: Date.now() - t,
      error: hasError ? JSON.stringify(json.error).slice(0, 200) : undefined,
    });

    // Step 7: Extract A2A response
    t = Date.now();
    let agentResponse: Record<string, unknown> = {};
    try {
      const rpcResult = (json.result ?? json) as Record<string, unknown>;
      const artifacts = (rpcResult as { artifacts?: Array<{ parts: Array<{ data?: Record<string, unknown> }> }> }).artifacts;
      agentResponse = artifacts?.[0]?.parts?.[0]?.data ?? rpcResult;
    } catch (extractErr) {
      steps.push({
        step: "7-extract-response",
        durationMs: Date.now() - t,
        error: extractErr instanceof Error ? extractErr.message : "extract failed",
      });
    }
    steps.push({ step: "7-extract-response", durationMs: Date.now() - t });

    // Step 8: Update job to completed
    t = Date.now();
    const { error: updateErr } = await admin
      .from("jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        output_summary: agentResponse,
        duration_ms: Date.now() - overall,
        verified: true,
      })
      .eq("id", jobId);
    steps.push({
      step: "8-update-job",
      durationMs: Date.now() - t,
      error: updateErr?.message,
    });

    return NextResponse.json({
      success: true,
      totalMs: Date.now() - overall,
      steps,
      httpStatus: res.status,
      hasResult,
      hasError,
      responseKeys: Object.keys(agentResponse),
      endpoint,
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      totalMs: Date.now() - overall,
      steps,
      error: err instanceof Error ? `${err.name}: ${err.message}` : "Unknown",
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5) : undefined,
    });
  }
}
