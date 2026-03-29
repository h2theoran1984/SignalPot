// POST /api/track — Lightweight telemetry beacon for external agent usage.
// Agents (or their wrappers) fire-and-forget a tiny JSON payload after each call.
// Auth: Bearer sp_live_xxx (standard API key) — must own the agent.
//
// Body: {
//   agent: "my-agent-slug" | "uuid",
//   event?: "call_completed" | "call_failed" | "call_started",
//   capability?: "market_analysis",
//   duration_ms?: 1230,
//   api_cost?: 0.003,
//   cost?: 0.01,
//   success?: true,
//   caller?: "external",
//   metadata?: { ... }
// }
//
// Returns 204 No Content on success (zero-overhead response).

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// CORS headers for cross-origin beacon calls
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────
  const auth = await getAuthContext(request);
  if (!auth) {
    return new NextResponse(null, { status: 401, headers: CORS_HEADERS });
  }

  // ── Parse body ─────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 400, headers: CORS_HEADERS });
  }

  const agentRef = body.agent as string | undefined;
  if (!agentRef) {
    return NextResponse.json(
      { error: "Missing required field: agent (slug or id)" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // ── Resolve agent + verify ownership ───────────────────────────────
  const admin = createAdminClient();

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentRef);
  const { data: agent } = await admin
    .from("agents")
    .select("id, owner_id")
    .eq(isUuid ? "id" : "slug", agentRef)
    .single();

  if (!agent || agent.owner_id !== auth.profileId) {
    return new NextResponse(null, { status: 403, headers: CORS_HEADERS });
  }

  // ── Insert telemetry event ─────────────────────────────────────────
  const event = (body.event as string) ?? "call_completed";
  const validEvents = ["call_completed", "call_failed", "call_started"];
  if (!validEvents.includes(event)) {
    return NextResponse.json(
      { error: `Invalid event type. Must be one of: ${validEvents.join(", ")}` },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const { error } = await admin.from("agent_telemetry").insert({
    agent_id: agent.id,
    profile_id: auth.profileId,
    event,
    capability: (body.capability as string) ?? null,
    duration_ms: typeof body.duration_ms === "number" ? Math.round(body.duration_ms) : null,
    api_cost: typeof body.api_cost === "number" ? body.api_cost : 0,
    cost: typeof body.cost === "number" ? body.cost : 0,
    success: body.success !== false,
    caller: (body.caller as string) ?? "external",
    metadata: typeof body.metadata === "object" && body.metadata !== null ? body.metadata : {},
  });

  if (error) {
    console.error("[track] Insert failed:", error.message);
    return new NextResponse(null, { status: 500, headers: CORS_HEADERS });
  }

  // 204 No Content — minimal response for fire-and-forget
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
