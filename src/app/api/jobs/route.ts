import { NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createJobSchema } from "@/lib/validations";

// POST /api/jobs — Record a job (always starts as pending, never verified)
export async function POST(request: Request) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasScope(auth, "jobs:write")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = createJobSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const input = result.data;

  // Verify the requester_agent_id belongs to the current user (if provided)
  if (input.requester_agent_id) {
    const { data: reqAgent } = await auth.supabase
      .from("agents")
      .select("owner_id")
      .eq("id", input.requester_agent_id)
      .single();

    if (!reqAgent || reqAgent.owner_id !== auth.profileId) {
      return NextResponse.json(
        { error: "requester_agent_id must belong to you" },
        { status: 403 }
      );
    }
  }

  // Verify the provider agent exists
  const { data: providerAgent } = await auth.supabase
    .from("agents")
    .select("id")
    .eq("id", input.provider_agent_id)
    .single();

  if (!providerAgent) {
    return NextResponse.json(
      { error: "Provider agent not found" },
      { status: 404 }
    );
  }

  // Jobs always start as "pending" and unverified.
  // Only the provider can mark them "completed" via PATCH (RLS enforced).
  const { data, error } = await auth.supabase
    .from("jobs")
    .insert({
      requester_agent_id: input.requester_agent_id ?? null,
      provider_agent_id: input.provider_agent_id,
      requester_profile_id: auth.profileId,
      job_type: input.job_type,
      capability_used: input.capability_used ?? null,
      input_summary: input.input_summary ?? null,
      output_summary: input.output_summary ?? null,
      status: "pending",
      duration_ms: input.duration_ms ?? null,
      cost: input.cost,
      verified: false,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to create job" },
      { status: 500 }
    );
  }

  return NextResponse.json(data, { status: 201 });
}
