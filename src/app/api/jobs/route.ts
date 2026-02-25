import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/jobs — Record a completed job
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  const {
    requester_agent_id,
    provider_agent_id,
    job_type,
    capability_used,
    input_summary,
    output_summary,
    status,
    duration_ms,
    cost,
    verified,
  } = body;

  if (!provider_agent_id) {
    return NextResponse.json(
      { error: "provider_agent_id is required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      requester_agent_id: requester_agent_id ?? null,
      provider_agent_id,
      requester_profile_id: user.id,
      job_type: job_type ?? "production",
      capability_used: capability_used ?? null,
      input_summary: input_summary ?? null,
      output_summary: output_summary ?? null,
      status: status ?? "completed",
      duration_ms: duration_ms ?? null,
      cost: cost ?? 0,
      verified: verified ?? false,
      completed_at: status === "completed" ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
