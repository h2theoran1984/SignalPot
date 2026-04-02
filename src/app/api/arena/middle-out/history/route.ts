// GET /api/arena/middle-out/history — Fetch Middle Out run history for an agent.
// Used by the agent dashboard to show past training runs.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { verifyArenaAdminAuth } from "@/lib/arena/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const isServiceRole = await verifyArenaAdminAuth(request);
  const auth = isServiceRole ? null : await getAuthContext(request);
  if (!isServiceRole && !auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const agentSlug = searchParams.get("agent");
  const capability = searchParams.get("capability");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20") || 20, 50);

  if (!agentSlug) {
    return NextResponse.json({ error: "agent parameter required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Resolve agent ID from slug
  const { data: agent } = await admin
    .from("agents")
    .select("id, name, slug")
    .eq("slug", agentSlug)
    .single();

  if (!agent) {
    return NextResponse.json({ error: `Agent '${agentSlug}' not found` }, { status: 404 });
  }

  let query = admin
    .from("middle_out_runs")
    .select("*")
    .eq("agent_id", agent.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (capability) {
    query = query.eq("capability", capability);
  }

  const { data: runs, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    agent: agent.slug,
    agent_name: agent.name,
    runs: runs ?? [],
  });
}
