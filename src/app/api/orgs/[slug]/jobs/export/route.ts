import { NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasOrgRole } from "@/lib/rbac";

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

// GET /api/orgs/[slug]/jobs/export — Download job history as CSV
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

  if (!hasOrgRole(auth, "viewer")) {
    return NextResponse.json({ error: "Requires viewer+ role" }, { status: 403 });
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

  // Date range defaults: last 30 days
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const start = searchParams.get("start") ?? thirtyDaysAgo.toISOString();
  const end = searchParams.get("end") ?? now.toISOString();

  // Get org member profile IDs to scope jobs to this org
  const { data: members } = await admin
    .from("org_members")
    .select("profile_id")
    .eq("org_id", org.id);

  const memberProfileIds = (members ?? []).map((m) => m.profile_id);

  if (memberProfileIds.length === 0) {
    // No members, return empty CSV
    const header = [
      "Job ID",
      "Provider Agent",
      "Capability",
      "Status",
      "Cost (USD)",
      "Duration (ms)",
      "Verified",
      "Created At",
    ];
    const today = now.toISOString().slice(0, 10);
    const csv = "\uFEFF" + header.join(",") + "\r\n";

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="jobs-${slug}-${today}.csv"`,
      },
    });
  }

  // Query jobs for org members with provider agent info
  const { data: jobs, error } = await admin
    .from("jobs")
    .select("id, provider_agent_id, capability_used, status, cost, duration_ms, verified, created_at, provider_agent:agents!jobs_provider_agent_id_fkey(name, slug)")
    .in("requester_profile_id", memberProfileIds)
    .gte("created_at", start)
    .lte("created_at", end)
    .order("created_at", { ascending: false })
    .limit(10000);

  if (error) {
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
  }

  // Build CSV
  const header = [
    "Job ID",
    "Provider Agent",
    "Capability",
    "Status",
    "Cost (USD)",
    "Duration (ms)",
    "Verified",
    "Created At",
  ];

  const rows = (jobs ?? []).map((j) => {
    const agentData = j.provider_agent as { name?: string; slug?: string } | null;
    const agentLabel = agentData?.name ?? agentData?.slug ?? j.provider_agent_id ?? "";
    return [
      escapeCSV(j.id ?? ""),
      escapeCSV(agentLabel),
      escapeCSV(j.capability_used ?? ""),
      escapeCSV(j.status ?? ""),
      escapeCSV(j.cost != null ? String(j.cost) : ""),
      escapeCSV(j.duration_ms != null ? String(j.duration_ms) : ""),
      escapeCSV(j.verified != null ? String(j.verified) : ""),
      escapeCSV(j.created_at ?? ""),
    ].join(",");
  });

  const today = now.toISOString().slice(0, 10);
  const csv = "\uFEFF" + [header.join(","), ...rows].join("\r\n") + "\r\n";

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="jobs-${slug}-${today}.csv"`,
    },
  });
}
