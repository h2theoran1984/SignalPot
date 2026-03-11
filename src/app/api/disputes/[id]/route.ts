import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateDisputeSchema } from "@/lib/validations";

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

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateDisputeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const body = parsed.data;
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

  // Fetch current dispute to validate status transitions
  const { data: currentDispute } = await admin
    .from("disputes")
    .select("status")
    .eq("id", id)
    .single();

  if (!currentDispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  // Validate status transitions
  const validTransitions: Record<string, string[]> = {
    open: ["reviewing", "resolved"],
    reviewing: ["resolved", "open"],
    resolved: ["appealed"],
    appealed: ["reviewing", "resolved"],
  };

  const allowed = validTransitions[currentDispute.status] ?? [];
  if (!allowed.includes(body.status)) {
    return NextResponse.json(
      { error: `Cannot transition from '${currentDispute.status}' to '${body.status}'` },
      { status: 400 }
    );
  }

  // Require resolution when resolving
  if (body.status === "resolved" && !body.resolution) {
    return NextResponse.json(
      { error: "Resolution is required when resolving a dispute" },
      { status: 400 }
    );
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
