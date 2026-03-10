import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewAuditLog } from "@/lib/rbac";

// GET /api/orgs/[slug]/audit — Paginated audit log (auditor+)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canViewAuditLog(auth)) {
    return NextResponse.json({ error: "Requires auditor+ role" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Resolve org
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .single();

  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // Verify auth context matches this org
  if (auth.orgId !== org.id) {
    return NextResponse.json({ error: "Org context mismatch" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50") || 50));
  const offset = (page - 1) * limit;
  const action = searchParams.get("action");

  let query = admin
    .from("audit_log")
    .select("id, actor_id, action, target_type, target_id, metadata, ip_address, created_at", {
      count: "exact",
    })
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (action) {
    query = query.eq("action", action);
  }

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Failed to fetch audit log" }, { status: 500 });
  }

  return NextResponse.json({
    events: data ?? [],
    total: count ?? 0,
    page,
    limit,
  });
}
