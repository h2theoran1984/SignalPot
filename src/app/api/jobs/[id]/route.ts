import { NextResponse } from "next/server";
import { getAuthContext, checkPublicRateLimit } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { updateJobSchema } from "@/lib/validations";
import { inngest } from "@/lib/inngest/client";

// GET /api/jobs/[id] — Get a job by ID
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return NextResponse.json({ error: "Invalid job ID format" }, { status: 400 });
  }

  const rateLimited = await checkPublicRateLimit(request);
  if (rateLimited) return rateLimited;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

// PATCH /api/jobs/[id] — Update job status (provider owner only)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return NextResponse.json({ error: "Invalid job ID format" }, { status: 400 });
  }

  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = updateJobSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const updates = result.data;

  // Fetch the job and verify the user owns the provider agent
  const { data: job } = await auth.supabase
    .from("jobs")
    .select("*, provider_agent:agents!jobs_provider_agent_id_fkey(owner_id)")
    .eq("id", id)
    .single();

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const providerOwnerId = job.provider_agent?.owner_id;
  if (providerOwnerId !== auth.profileId) {
    return NextResponse.json(
      { error: "Only the provider agent owner can update job status" },
      { status: 403 }
    );
  }

  // Validate status transitions
  const validTransitions: Record<string, string[]> = {
    pending: ["running", "failed"],
    running: ["completed", "failed"],
  };

  if (updates.status) {
    const allowed = validTransitions[job.status] ?? [];
    if (!allowed.includes(updates.status)) {
      return NextResponse.json(
        { error: `Cannot transition from '${job.status}' to '${updates.status}'` },
        { status: 400 }
      );
    }
  }

  // Build the update payload
  const updatePayload: Record<string, unknown> = { ...updates };
  if (updates.status === "completed") {
    updatePayload.completed_at = new Date().toISOString();
  }

  const { data, error } = await auth.supabase
    .from("jobs")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to update job" },
      { status: 500 }
    );
  }

  // On completion, fire an async Inngest event to settle the platform fee.
  // This moves settlement off the synchronous request path — faster response,
  // with retry logic handled by Inngest if the RPC fails.
  if (updates.status === "completed") {
    const feePct = parseInt(process.env.PLATFORM_FEE_PCT ?? "10", 10);
    await inngest.send({
      name: "job/completed",
      data: { job_id: id, platform_fee_pct: feePct },
    });
  }

  return NextResponse.json(data);
}
