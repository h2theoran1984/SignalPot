import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest/client";

/**
 * POST /api/arena/trigger
 * Manually fire the Inngest event for a pending match.
 * Auth required — only the match creator can trigger.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const matchId = body.match_id as string;
  if (!matchId) {
    return NextResponse.json({ error: "Missing match_id" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify match exists and is pending
  const { data: match, error } = await admin
    .from("arena_matches")
    .select("id, status, creator_id")
    .eq("id", matchId)
    .single();

  if (error || !match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  if (match.creator_id !== auth.profileId) {
    return NextResponse.json({ error: "Not your match" }, { status: 403 });
  }

  if (match.status !== "pending") {
    return NextResponse.json({ error: `Match is ${match.status}, not pending` }, { status: 400 });
  }

  // Fire the event
  await inngest.send({
    name: "arena/match.created",
    data: { match_id: matchId },
  });

  return NextResponse.json({ triggered: true, match_id: matchId });
}
