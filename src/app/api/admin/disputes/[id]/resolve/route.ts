import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleDispute } from "@/lib/escrow";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthContext(req);
  if (!auth?.profileId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Verify is_admin flag on the authenticated profile
  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", auth.profileId)
    .single();

  if (!profile?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Parse resolution from JSON body or form data
  let resolution: "upheld" | "rejected" | "partial";
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = await req.json();
    resolution = body.resolution;
  } else {
    // form POST (from admin page HTML form)
    const formData = await req.formData();
    resolution = formData.get("resolution") as "upheld" | "rejected" | "partial";
  }

  if (!resolution || !["upheld", "rejected", "partial"].includes(resolution)) {
    return NextResponse.json(
      { error: "Invalid resolution — must be upheld, rejected, or partial" },
      { status: 400 }
    );
  }

  // Fetch dispute to verify it exists and get job_id
  const { data: existing, error: fetchError } = await admin
    .from("disputes")
    .select("id, job_id, tier, status")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  if (existing.status === "resolved") {
    return NextResponse.json(
      { error: "Dispute already resolved" },
      { status: 409 }
    );
  }

  // Update dispute to resolved
  const { data: dispute, error: updateError } = await admin
    .from("disputes")
    .update({
      status: "resolved",
      resolution,
      resolver_notes: "[Tier 3 — Platform admin]",
      resolved_at: new Date().toISOString(),
      tier: 3,
    })
    .eq("id", id)
    .select()
    .single();

  if (updateError || !dispute) {
    return NextResponse.json(
      { error: "Failed to update dispute" },
      { status: 500 }
    );
  }

  // Settle deposits
  await settleDispute(id, resolution, existing.job_id as string);

  // If this was a form POST, redirect back to admin queue
  if (!contentType.includes("application/json")) {
    return NextResponse.redirect(
      new URL("/admin/disputes", req.url),
      { status: 303 }
    );
  }

  return NextResponse.json({ dispute });
}
