import { NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewAuditLog } from "@/lib/rbac";

/**
 * Escape a value for CSV output.
 * Wraps in double quotes if the value contains commas, quotes, or newlines.
 * Any embedded double quotes are doubled per RFC 4180.
 */
function escapeCSV(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// GET /api/orgs/[slug]/audit/export — Download audit log as CSV
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(auth, "jobs:read")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
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
  const action = searchParams.get("action");

  // Date range defaults: last 30 days
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const start = searchParams.get("start") ?? thirtyDaysAgo.toISOString();
  const end = searchParams.get("end") ?? now.toISOString();

  let query = admin
    .from("audit_log")
    .select("id, actor_id, action, target_type, target_id, metadata, ip_address, created_at")
    .eq("org_id", org.id)
    .gte("created_at", start)
    .lte("created_at", end)
    .order("created_at", { ascending: false })
    .limit(10000);

  if (action) {
    query = query.eq("action", action);
  }

  const { data: events, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Failed to fetch audit log" }, { status: 500 });
  }

  // Collect unique actor IDs to resolve display names and emails
  const actorIds = [...new Set((events ?? []).map((e) => e.actor_id).filter(Boolean))];
  const actorMap = new Map<string, { display_name: string; email: string }>();

  if (actorIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name, email")
      .in("id", actorIds);

    for (const p of profiles ?? []) {
      actorMap.set(p.id, {
        display_name: p.display_name ?? "",
        email: p.email ?? "",
      });
    }
  }

  // Build CSV
  const header = [
    "Timestamp",
    "Actor Email",
    "Actor Name",
    "Action",
    "Target Type",
    "Target ID",
    "IP Address",
    "Metadata",
  ];

  const rows = (events ?? []).map((e) => {
    const actor = actorMap.get(e.actor_id) ?? { display_name: "", email: "" };
    return [
      escapeCSV(e.created_at ?? ""),
      escapeCSV(actor.email),
      escapeCSV(actor.display_name),
      escapeCSV(e.action ?? ""),
      escapeCSV(e.target_type ?? ""),
      escapeCSV(e.target_id ?? ""),
      escapeCSV(e.ip_address ?? ""),
      escapeCSV(e.metadata ? JSON.stringify(e.metadata) : ""),
    ].join(",");
  });

  const today = now.toISOString().slice(0, 10);
  const csv = "\uFEFF" + [header.join(","), ...rows].join("\r\n") + "\r\n";

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${slug}-${today}.csv"`,
    },
  });
}
