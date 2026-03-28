// ELO rating system for Arena agent rankings.
// Standard ELO with K=32. Each agent has a per-capability rating.

import { createAdminClient } from "@/lib/supabase/admin";

const K_FACTOR = 32;
const DEFAULT_ELO = 1200;
const SPARRING_PARTNER_ELO = 1200; // Default — scales with level
const SPARRING_ELO_BY_LEVEL: Record<number, number> = {
  1: 1200,
  2: 1300,
  3: 1500,
  4: 1700,
};

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
  winner: "a" | "b" | "tie",
  slugA?: string,
  slugB?: string,
  level?: number | null
): Promise<{ eloA: number; eloB: number; deltaA: number; deltaB: number }> {
  const admin = createAdminClient();

  const SPARRING_SLUG = "sparring-partner";
  const aIsSparring = slugA === SPARRING_SLUG;
  const bIsSparring = slugB === SPARRING_SLUG;

  const RATING_COLS = "elo, matches_played, wins, losses, ties";

  // Sparring Partner ELO scales with level
  const sparringElo = SPARRING_ELO_BY_LEVEL[level ?? 1] ?? SPARRING_PARTNER_ELO;
  let oldEloA = sparringElo;
  let oldEloB = sparringElo;

  // Fetch or create rating for Agent A (skip if Sparring Partner)
  let ratingA: Record<string, unknown> | null = null;
  if (!aIsSparring) {
    const { data } = await admin
      .from("arena_ratings")
      .select(RATING_COLS)
      .eq("agent_id", agentAId)
      .eq("capability", capability)
      .single();
    ratingA = data;

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
        .select(RATING_COLS)
        .single();
      ratingA = created;
    }
    oldEloA = (ratingA?.elo as number) ?? DEFAULT_ELO;
  }

  // Fetch or create rating for Agent B (skip if Sparring Partner)
  let ratingB: Record<string, unknown> | null = null;
  if (!bIsSparring) {
    const { data } = await admin
      .from("arena_ratings")
      .select(RATING_COLS)
      .eq("agent_id", agentBId)
      .eq("capability", capability)
      .single();
    ratingB = data;

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
        .select(RATING_COLS)
        .single();
      ratingB = created;
    }
    oldEloB = (ratingB?.elo as number) ?? DEFAULT_ELO;
  }

  // Calculate new ELO (Sparring Partner always anchored at 1200)
  const { newA, newB } = calculateElo(oldEloA, oldEloB, winner);

  // Update Agent A (skip if Sparring Partner — its ELO is fixed)
  if (!aIsSparring) {
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
  }

  // Update Agent B (skip if Sparring Partner — its ELO is fixed)
  if (!bIsSparring) {
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
  }

  return {
    eloA: aIsSparring ? sparringElo : newA,
    eloB: bIsSparring ? sparringElo : newB,
    deltaA: aIsSparring ? 0 : newA - oldEloA,
    deltaB: bIsSparring ? 0 : newB - oldEloB,
  };
}

/**
 * Fetch the current ELO for an agent on a specific capability.
 * Returns DEFAULT_ELO (1200) if no rating row exists yet.
 */
export async function getAgentElo(
  agentId: string,
  capability: string
): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("arena_ratings")
    .select("elo")
    .eq("agent_id", agentId)
    .eq("capability", capability)
    .single();

  return (data?.elo as number) ?? DEFAULT_ELO;
}
