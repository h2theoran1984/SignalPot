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
      *,
      agent_a:agents!arena_matches_agent_a_id_fkey(id, name, slug, description, tags, rate_amount, rate_type),
      agent_b:agents!arena_matches_agent_b_id_fkey(id, name, slug, description, tags, rate_amount, rate_type),
      challenge:arena_challenges(*)
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

  return NextResponse.json({
    match: {
      ...match,
      viewer_vote,
    },
  });
}
