import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasOrgRole } from "@/lib/rbac";

// GET /api/orgs/[slug]/analytics — Org usage analytics (viewer+)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const view = searchParams.get("view") ?? "summary";
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  const rpcArgs: Record<string, unknown> = { p_org_id: org.id };
  if (start) rpcArgs.p_start_date = start;
  if (end) rpcArgs.p_end_date = end;

  if (view === "summary") {
    const { data, error } = await admin.rpc("get_org_usage_stats", rpcArgs);
    if (error) {
      return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
    }
    return NextResponse.json(Array.isArray(data) ? data[0] : data);
  }

  if (view === "top-agents") {
    const limit = searchParams.get("limit");
    if (limit) rpcArgs.p_limit = parseInt(limit) || 10;
    const { data, error } = await admin.rpc("get_org_top_agents", rpcArgs);
    if (error) {
      return NextResponse.json({ error: "Failed to fetch top agents" }, { status: 500 });
    }
    return NextResponse.json({ agents: data ?? [] });
  }

  if (view === "daily") {
    const { data, error } = await admin.rpc("get_org_daily_usage", rpcArgs);
    if (error) {
      return NextResponse.json({ error: "Failed to fetch daily usage" }, { status: 500 });
    }
    return NextResponse.json({ days: data ?? [] });
  }

  return NextResponse.json({ error: "Invalid view parameter" }, { status: 400 });
}
