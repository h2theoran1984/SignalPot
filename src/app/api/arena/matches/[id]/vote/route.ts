import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { voteSchema } from "@/lib/arena/validations";

/**
 * POST /api/arena/matches/[id]/vote — Cast a vote (auth required)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized — sign in to vote" }, { status: 401 });
  }

  // Parse body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = voteSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid vote", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { vote } = parsed.data;
  const admin = createAdminClient();

  // Verify match exists and is in voting status
  const { data: match } = await admin
    .from("arena_matches")
    .select("id, status, voting_ends_at")
    .eq("id", id)
    .single();

  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  if (match.status !== "voting") {
    return NextResponse.json(
      { error: "Voting is not open for this match" },
      { status: 400 }
    );
  }

  // Check voting hasn't expired
  if (match.voting_ends_at && new Date(match.voting_ends_at) < new Date()) {
    return NextResponse.json(
      { error: "Voting period has ended" },
      { status: 400 }
    );
  }

  // Insert vote (unique constraint prevents double-voting)
  const { error: voteError } = await admin
    .from("arena_votes")
    .insert({
      match_id: id,
      voter_id: auth.profileId,
      vote,
    });

  if (voteError) {
    if (voteError.code === "23505") {
      return NextResponse.json(
        { error: "You have already voted on this match" },
        { status: 409 }
      );
    }
    console.error("[arena] Vote error:", voteError);
    return NextResponse.json({ error: "Failed to cast vote" }, { status: 500 });
  }

  // Increment vote count on the match
  const voteColumn = vote === "a" ? "votes_a" : vote === "b" ? "votes_b" : "votes_tie";

  // Fetch current counts and increment
  const { data: updated } = await admin
    .from("arena_matches")
    .select("votes_a, votes_b, votes_tie")
    .eq("id", id)
    .single();

  if (updated) {
    await admin
      .from("arena_matches")
      .update({ [voteColumn]: (updated[voteColumn] as number) + 1 })
      .eq("id", id);
  }

  // Return updated counts
  const { data: final } = await admin
    .from("arena_matches")
    .select("votes_a, votes_b, votes_tie")
    .eq("id", id)
    .single();

  return NextResponse.json({
    vote,
    votes_a: final?.votes_a ?? 0,
    votes_b: final?.votes_b ?? 0,
    votes_tie: final?.votes_tie ?? 0,
  });
}
