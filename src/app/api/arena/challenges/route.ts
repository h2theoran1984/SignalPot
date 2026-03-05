import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/arena/challenges — List challenge prompts (public)
 */
export async function GET(request: NextRequest) {
  const admin = createAdminClient();
  const url = new URL(request.url);

  const capability = url.searchParams.get("capability");
  const featured = url.searchParams.get("featured");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));
  const offset = (page - 1) * limit;

  let query = admin
    .from("arena_challenges")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (capability) {
    query = query.eq("capability", capability);
  }

  if (featured === "true") {
    query = query.eq("featured", true);
  }

  const { data: challenges, count, error } = await query;

  if (error) {
    console.error("[arena] Challenges list error:", error);
    return NextResponse.json({ error: "Failed to list challenges" }, { status: 500 });
  }

  return NextResponse.json({
    challenges: challenges ?? [],
    total: count ?? 0,
  });
}
