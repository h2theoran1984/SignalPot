// GET /api/arena/tunable-agents — Returns agents that have prompt versions (SignalPot-managed).
// Used by AutoTune v2 to filter the agent dropdown.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const admin = createAdminClient();

  // Get distinct agent IDs that have at least one active prompt version
  const { data: versions } = await admin
    .from("prompt_versions")
    .select("agent_id")
    .eq("is_active", true);

  if (!versions || versions.length === 0) {
    return NextResponse.json({ agents: [] });
  }

  const agentIds = [...new Set(versions.map((v) => v.agent_id as string))];

  // Fetch agent details for those IDs
  const { data: agents } = await admin
    .from("agents")
    .select("id, name, slug, description, capability_schema")
    .in("id", agentIds)
    .eq("status", "active");

  return NextResponse.json({ agents: agents ?? [] });
}
