import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/arena/challenges — List challenge prompts (public)
 */
export async function GET(request: NextRequest) {
  const admin = createAdminClient();
  const url = new URL(request.url);

  const VALID_DIFFICULTIES = new Set(["easy", "medium", "hard"]);

  const capability = url.searchParams.get("capability");
  const rawDifficulty = url.searchParams.get("difficulty");
  const featured = url.searchParams.get("featured");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));
  const offset = (page - 1) * limit;

  // Validate enum query params — ignore invalid values
  const difficulty = rawDifficulty && VALID_DIFFICULTIES.has(rawDifficulty) ? rawDifficulty : null;

  let query = admin
    .from("arena_challenges")
    .select("id, title, description, capability, difficulty, prompt, tags, featured, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (capability) {
    query = query.eq("capability", capability);
  }

  if (difficulty) {
    query = query.eq("difficulty", difficulty);
  }

  if (featured === "true") {
    query = query.eq("featured", true);
  }

  const { data: challenges, count, error } = await query;

  if (error) {
    console.error("[arena] Challenges list query failed");
    return NextResponse.json({ error: "Failed to list challenges" }, { status: 500 });
  }

  return NextResponse.json(
    {
      challenges: challenges ?? [],
      total: count ?? 0,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    }
  );
}
