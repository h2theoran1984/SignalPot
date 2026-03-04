import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthContext(req);
  if (!auth?.profileId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const admin = createAdminClient();

  const { data: dispute, error } = await admin
    .from("disputes")
    .select(
      "*, jobs(id, status, rate_amount, input_summary, output_summary), dispute_deposits(*)"
    )
    .eq("id", id)
    .eq("filed_by_profile_id", auth.profileId)
    .single();

  if (error || !dispute)
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  return NextResponse.json({ dispute });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthContext(req);
  if (!auth?.profileId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const admin = createAdminClient();

  // Check admin flag on profile (Sprint 11 will add proper admin UI)
  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", auth.profileId)
    .single();

  if (!profile?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: dispute, error } = await admin
    .from("disputes")
    .update({
      status: body.status,
      resolution: body.resolution,
      resolver_notes: body.resolver_notes,
      resolved_at:
        body.status === "resolved" ? new Date().toISOString() : null,
      tier: body.tier ?? undefined,
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !dispute)
    return NextResponse.json({ error: "Failed to update dispute" }, { status: 500 });
  return NextResponse.json({ dispute });
}
