import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/arena/ratings?agent=slug&capability=X
 *
 * Returns the ELO rating for an agent in a specific capability.
 * Used by the match creation page to check level unlock status.
 */
export async function GET(request: NextRequest) {
  const agentSlug = request.nextUrl.searchParams.get("agent");
  const capability = request.nextUrl.searchParams.get("capability");

  if (!agentSlug) {
    return NextResponse.json(
      { error: "agent query param is required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Look up the agent ID from slug
  const { data: agent } = await supabase
    .from("agents")
    .select("id")
    .eq("slug", agentSlug)
    .single();

  if (!agent) {
    return NextResponse.json(
      { error: `Agent '${agentSlug}' not found` },
      { status: 404 }
    );
  }

  // If capability specified, return single rating
  if (capability) {
    const { data: rating } = await supabase
      .from("arena_ratings")
      .select("elo, matches_played, wins, losses, ties")
      .eq("agent_id", agent.id)
      .eq("capability", capability)
      .single();

    const cacheHeaders = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" };

    return NextResponse.json(
      {
        agent: agentSlug,
        capability,
        elo: (rating?.elo as number) ?? 1200,
        matches_played: (rating?.matches_played as number) ?? 0,
        wins: (rating?.wins as number) ?? 0,
        losses: (rating?.losses as number) ?? 0,
        ties: (rating?.ties as number) ?? 0,
      },
      { headers: cacheHeaders }
    );
  }

  // No capability — return all ratings for this agent
  const { data: ratings } = await supabase
    .from("arena_ratings")
    .select("capability, elo, matches_played, wins, losses, ties")
    .eq("agent_id", agent.id)
    .order("elo", { ascending: false });

  return NextResponse.json(
    {
      agent: agentSlug,
      ratings: (ratings ?? []).map((r) => ({
        capability: r.capability,
        elo: r.elo,
        matches_played: r.matches_played,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
      })),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    }
  );
}
