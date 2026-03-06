import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/auth";

/**
 * GET /api/arena/matches/[id] — Get match detail (public)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: match, error } = await admin
    .from("arena_matches")
    .select(
      `
      id, capability, status, match_type, level, winner,
      votes_a, votes_b, votes_tie,
      duration_a_ms, duration_b_ms, verified_a, verified_b,
      voting_ends_at, started_at, completed_at, created_at,
      prompt, prompt_text, response_a, response_b,
      judgment_reasoning, judgment_confidence, judgment_source,
      cost_a, cost_b,
      agent_a:agents!arena_matches_agent_a_id_fkey(id, name, slug, description, tags, rate_amount, rate_type),
      agent_b:agents!arena_matches_agent_b_id_fkey(id, name, slug, description, tags, rate_amount, rate_type),
      challenge:arena_challenges(id, capability, difficulty, prompt, prompt_text, featured)
      `
    )
    .eq("id", id)
    .single();

  if (error || !match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  // Check if viewer has voted (if authenticated)
  let viewer_vote: string | null = null;
  try {
    const auth = await getAuthContext(request);
    if (auth) {
      const { data: vote } = await admin
        .from("arena_votes")
        .select("vote")
        .eq("match_id", id)
        .eq("voter_id", auth.profileId)
        .maybeSingle();

      if (vote) {
        viewer_vote = vote.vote;
      }
    }
  } catch {
    // Auth check failed — viewer is anonymous, that's fine
  }

  return NextResponse.json(
    {
      match: {
        ...match,
        viewer_vote,
      },
    },
    {
      headers: {
        // Short cache since match state changes during live matches
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30",
      },
    }
  );
}
