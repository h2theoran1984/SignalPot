// GET /api/arena/training/report — Training analysis report for an agent.
// Returns aggregated performance stats from sparring partner matches
// with per-criterion trends and LLM-generated coaching advice.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateTrainingReport } from "@/lib/arena/training-report";

export async function GET(request: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse query params ─────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agent_id");
  const matchCountParam = searchParams.get("match_count");

  if (!agentId) {
    return NextResponse.json(
      { error: "Missing required query parameter: agent_id" },
      { status: 400 }
    );
  }

  const matchCount = matchCountParam ? parseInt(matchCountParam, 10) : 10;
  if (isNaN(matchCount) || matchCount < 1 || matchCount > 100) {
    return NextResponse.json(
      { error: "match_count must be between 1 and 100" },
      { status: 400 }
    );
  }

  // ── Verify agent ownership ─────────────────────────────────────────
  const admin = createAdminClient();

  // Support both UUID and slug lookups
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId);
  const { data: agent, error: agentErr } = await admin
    .from("agents")
    .select("id, owner_id")
    .eq(isUuid ? "id" : "slug", agentId)
    .single();

  if (agentErr || !agent) {
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
    const report = await generateTrainingReport(admin, agent.id, { matchCount });
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[arena/training/report] Error:", message);

    // Surface user-friendly errors (no matches, agent not found, etc.)
    if (
      message.includes("not found") ||
      message.includes("No completed")
    ) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to generate training report" },
      { status: 500 }
    );
  }
}
