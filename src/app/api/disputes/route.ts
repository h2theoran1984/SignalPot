import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { inngest } from "@/lib/inngest/client";

const createDisputeSchema = z.object({
  job_id: z.string().uuid(),
  reason: z
    .string()
    .min(20, "Please provide at least 20 characters explaining the dispute")
    .max(2000),
});

export async function POST(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth?.profileId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = createDisputeSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { job_id, reason } = parsed.data;
  const admin = createAdminClient();

  // Fetch the job — must be completed and filed within 72h
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select(
      "id, requester_profile_id, provider_agent_id, status, completed_at, rate_amount, input_summary, output_summary"
    )
    .eq("id", job_id)
    .single();

  if (jobError || !job)
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.status !== "completed")
    return NextResponse.json(
      { error: "Can only dispute completed jobs" },
      { status: 400 }
    );
  if (job.requester_profile_id !== auth.profileId)
    return NextResponse.json(
      { error: "Only the requester can file a dispute" },
      { status: 403 }
    );

  // 72h window
  const completedAt = job.completed_at ? new Date(job.completed_at) : null;
  if (!completedAt || Date.now() - completedAt.getTime() > 72 * 60 * 60 * 1000) {
    return NextResponse.json(
      { error: "Dispute window has closed (72 hours after completion)" },
      { status: 400 }
    );
  }

  // Check no existing open dispute for this job
  const { data: existing } = await admin
    .from("disputes")
    .select("id")
    .eq("job_id", job_id)
    .neq("status", "resolved")
    .maybeSingle();

  if (existing)
    return NextResponse.json(
      { error: "A dispute is already open for this job" },
      { status: 409 }
    );

  // Build evidence from envelopes stored in job JSONB
  const evidence = {
    input_envelope: (job.input_summary as Record<string, unknown>)?._envelope ?? null,
    output_envelope: (job.output_summary as Record<string, unknown>)?._envelope ?? null,
    rate_amount: job.rate_amount,
  };

  // Create dispute
  const { data: dispute, error: disputeError } = await admin
    .from("disputes")
    .insert({
      job_id,
      filed_by_profile_id: auth.profileId,
      reason,
      evidence,
      tier: 1,
      status: "open",
    })
    .select()
    .single();

  if (disputeError || !dispute)
    return NextResponse.json({ error: "Failed to create dispute" }, { status: 500 });

  // Stake deposit: 2x rate_amount from requester (deduct from balance)
  const depositMillicents = Math.floor((job.rate_amount ?? 0) * 100000 * 2);
  if (depositMillicents > 0) {
    // Check balance
    const { data: profile } = await admin
      .from("profiles")
      .select("credit_balance_millicents")
      .eq("id", auth.profileId)
      .single();

    if ((profile?.credit_balance_millicents ?? 0) < depositMillicents) {
      // Delete the dispute and return error
      await admin.from("disputes").delete().eq("id", dispute.id);
      return NextResponse.json(
        { error: "Insufficient balance for dispute deposit (requires 2x job cost)" },
        { status: 400 }
      );
    }

    // Deduct and record deposit
    await admin
      .from("profiles")
      .update({
        credit_balance_millicents:
          profile!.credit_balance_millicents - depositMillicents,
      })
      .eq("id", auth.profileId);

    await admin.from("dispute_deposits").insert({
      dispute_id: dispute.id,
      profile_id: auth.profileId,
      amount_millicents: depositMillicents,
      status: "held",
    });
  }

  // Fire Inngest event for Tier 1 AI resolution
  await inngest.send({
    name: "dispute/filed",
    data: { dispute_id: dispute.id, job_id },
  });

  return NextResponse.json({ dispute }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth?.profileId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: disputes, error } = await admin
    .from("disputes")
    .select("*, jobs(id, status, rate_amount, provider_agent_id)")
    .eq("filed_by_profile_id", auth.profileId)
    .order("filed_at", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ disputes });
}
