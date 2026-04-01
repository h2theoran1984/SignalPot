// GET /api/arena/extract — Full agent extract report.
// Returns detailed per-match breakdown across all match types,
// cost analysis, criteria summary, and LLM-generated recommendations.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateExtractReport } from "@/lib/arena/extract-report";

export async function GET(request: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse query params ─────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agent_id");
  const limitParam = searchParams.get("limit");

  if (!agentId) {
    return NextResponse.json(
      { error: "Missing required query parameter: agent_id" },
      { status: 400 }
    );
  }

  const limit = limitParam ? parseInt(limitParam, 10) : 200;
  if (isNaN(limit) || limit < 1 || limit > 500) {
    return NextResponse.json(
      { error: "limit must be between 1 and 500" },
      { status: 400 }
    );
  }

  // ── Verify agent ownership ─────────────────────────────────────────
  const admin = createAdminClient();

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId);
  const { data: agent, error: agentErr } = await admin
    .from("agents")
    .select("id, owner_id")
    .eq(isUuid ? "id" : "slug", agentId)
    .single();

  if (agentErr || !agent) {
    console.error(`[arena/extract] Agent lookup failed: query=${isUuid ? "id" : "slug"}=${agentId}, error=${agentErr?.message ?? "no data"}, code=${agentErr?.code ?? "none"}`);
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (agent.owner_id !== auth.profileId) {
    return NextResponse.json(
      { error: "You do not own this agent" },
      { status: 403 }
    );
  }

  // ── Generate report ────────────────────────────────────────────────
  try {
    const report = await generateExtractReport(admin, agent.id, { limit });
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[arena/extract] Error:", message);

    if (message.includes("not found") || message.includes("No completed")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to generate extract report" },
      { status: 500 }
    );
  }
}
