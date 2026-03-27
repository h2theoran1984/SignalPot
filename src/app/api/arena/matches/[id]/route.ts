import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/auth";

/**
 * GET /api/arena/matches/[id] — Get match detail (public)
 * Includes judgment_breakdown, resolved_prompt, and ELO ratings for both agents.
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
      agent_a_id, agent_b_id,
      votes_a, votes_b, votes_tie,
      duration_a_ms, duration_b_ms, verified_a, verified_b,
      voting_ends_at, started_at, completed_at, created_at,
      prompt, prompt_text, resolved_prompt, response_a, response_b,
      judgment_reasoning, judgment_confidence, judgment_source, judgment_breakdown,
      cost_a, cost_b,
      agent_a:agents!arena_matches_agent_a_id_fkey(id, name, slug, description, tags, rate_amount, rate_type),
      agent_b:agents!arena_matches_agent_b_id_fkey(id, name, slug, description, tags, rate_amount, rate_type),
      challenge:arena_challenges(id, title, description, capability, difficulty, prompt, tags, featured)
      `
    )
    .eq("id", id)
    .single();

  if (error || !match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  // Fetch ELO ratings for both agents in this capability
  let elo_a: number = 1200;
  let elo_b: number = 1200;

  const agentA = match.agent_a as unknown as { id: string; slug: string } | null;
  const agentB = match.agent_b as unknown as { id: string; slug: string } | null;
  const SPARRING_SLUG = "sparring-partner";

  if (agentA && agentA.slug !== SPARRING_SLUG) {
    const { data: ratingA } = await admin
      .from("arena_ratings")
      .select("elo")
      .eq("agent_id", match.agent_a_id)
      .eq("capability", match.capability)
      .maybeSingle();
    if (ratingA) elo_a = ratingA.elo as number;
  }

  if (agentB && agentB.slug !== SPARRING_SLUG) {
    const { data: ratingB } = await admin
      .from("arena_ratings")
      .select("elo")
      .eq("agent_id", match.agent_b_id)
      .eq("capability", match.capability)
      .maybeSingle();
    if (ratingB) elo_b = ratingB.elo as number;
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
        elo_a,
        elo_b,
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
