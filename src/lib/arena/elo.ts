// ELO rating system for Arena agent rankings.
// Standard ELO with K=32. Each agent has a per-capability rating.

import { createAdminClient } from "@/lib/supabase/admin";

const K_FACTOR = 32;
const DEFAULT_ELO = 1200;

/**
 * Calculate new ELO ratings given current ratings and match result.
 * Standard ELO formula: K=32, expected score uses 400-point scale.
 *
 * @param ratingA - Current ELO of agent A
 * @param ratingB - Current ELO of agent B
 * @param result - "a" (A wins), "b" (B wins), or "tie"
 * @returns New ratings for both agents
 */
export function calculateElo(
  ratingA: number,
  ratingB: number,
  result: "a" | "b" | "tie"
): { newA: number; newB: number } {
  // Expected scores
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;

  // Actual scores
  let scoreA: number;
  let scoreB: number;

  if (result === "a") {
    scoreA = 1;
    scoreB = 0;
  } else if (result === "b") {
    scoreA = 0;
    scoreB = 1;
  } else {
    scoreA = 0.5;
    scoreB = 0.5;
  }

  // New ratings
  const newA = Math.round(ratingA + K_FACTOR * (scoreA - expectedA));
  const newB = Math.round(ratingB + K_FACTOR * (scoreB - expectedB));

  return { newA, newB };
}

/**
 * Update ELO ratings in the database after a match.
 * Fetches or creates arena_ratings rows for both agents + capability,
 * calculates new ELO, and updates ratings + win/loss/tie counters.
 */
export async function updateElo(
  agentAId: string,
  agentBId: string,
  capability: string,
  winner: "a" | "b" | "tie"
): Promise<{ eloA: number; eloB: number; deltaA: number; deltaB: number }> {
  const admin = createAdminClient();

  // Fetch or create rating for Agent A
  let { data: ratingA } = await admin
    .from("arena_ratings")
    .select("*")
    .eq("agent_id", agentAId)
    .eq("capability", capability)
    .single();

  if (!ratingA) {
    const { data: created } = await admin
      .from("arena_ratings")
      .insert({
        agent_id: agentAId,
        capability,
        elo: DEFAULT_ELO,
        matches_played: 0,
        wins: 0,
        losses: 0,
        ties: 0,
      })
      .select("*")
      .single();
    ratingA = created;
  }

  // Fetch or create rating for Agent B
  let { data: ratingB } = await admin
    .from("arena_ratings")
    .select("*")
    .eq("agent_id", agentBId)
    .eq("capability", capability)
    .single();

  if (!ratingB) {
    const { data: created } = await admin
      .from("arena_ratings")
      .insert({
        agent_id: agentBId,
        capability,
        elo: DEFAULT_ELO,
        matches_played: 0,
        wins: 0,
        losses: 0,
        ties: 0,
      })
      .select("*")
      .single();
    ratingB = created;
  }

  const oldEloA = (ratingA?.elo as number) ?? DEFAULT_ELO;
  const oldEloB = (ratingB?.elo as number) ?? DEFAULT_ELO;

  // Calculate new ELO
  const { newA, newB } = calculateElo(oldEloA, oldEloB, winner);

  // Update Agent A
  const updateA: Record<string, unknown> = {
    elo: newA,
    matches_played: ((ratingA?.matches_played as number) ?? 0) + 1,
    updated_at: new Date().toISOString(),
  };

  if (winner === "a") {
    updateA.wins = ((ratingA?.wins as number) ?? 0) + 1;
  } else if (winner === "b") {
    updateA.losses = ((ratingA?.losses as number) ?? 0) + 1;
  } else {
    updateA.ties = ((ratingA?.ties as number) ?? 0) + 1;
  }

  await admin
    .from("arena_ratings")
    .update(updateA)
    .eq("agent_id", agentAId)
    .eq("capability", capability);

  // Update Agent B
  const updateB: Record<string, unknown> = {
    elo: newB,
    matches_played: ((ratingB?.matches_played as number) ?? 0) + 1,
    updated_at: new Date().toISOString(),
  };

  if (winner === "b") {
    updateB.wins = ((ratingB?.wins as number) ?? 0) + 1;
  } else if (winner === "a") {
    updateB.losses = ((ratingB?.losses as number) ?? 0) + 1;
  } else {
    updateB.ties = ((ratingB?.ties as number) ?? 0) + 1;
  }

  await admin
    .from("arena_ratings")
    .update(updateB)
    .eq("agent_id", agentBId)
    .eq("capability", capability);

  return {
    eloA: newA,
    eloB: newB,
    deltaA: newA - oldEloA,
    deltaB: newB - oldEloB,
  };
}
