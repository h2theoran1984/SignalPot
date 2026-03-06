import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/arena/leaderboard — Public arena rankings
 *
 * Returns per-capability rankings, overall (pound-for-pound) rankings
 * computed as average ELO across all capabilities, and the 5 most
 * recent completed matches with agent info.
 */
export async function GET() {
  const admin = createAdminClient();

  // ── 1. Fetch all arena ratings joined with agent info ────────────
  const { data: ratings, error: ratingsErr } = await admin
    .from("arena_ratings")
    .select(
      `
      id,
      agent_id,
      capability,
      elo,
      matches_played,
      wins,
      losses,
      ties,
      updated_at,
      agent:agents!arena_ratings_agent_id_fkey(id, name, slug, description)
      `
    )
    .order("elo", { ascending: false });

  if (ratingsErr) {
    console.error("[arena/leaderboard] Ratings query error:", ratingsErr);
    return NextResponse.json(
      { error: "Failed to load rankings" },
      { status: 500 }
    );
  }

  // ── 2. Build per-capability rankings (divisions) ─────────────────
  const divisionMap = new Map<
    string,
    Array<{
      agent_id: string;
      agent_name: string;
      agent_slug: string;
      agent_description: string | null;
      elo: number;
      matches_played: number;
      wins: number;
      losses: number;
      ties: number;
    }>
  >();

  for (const r of ratings ?? []) {
    const agent = r.agent as unknown as { id: string; name: string; slug: string; description: string | null } | null;
    if (!agent) continue;

    const entry = {
      agent_id: r.agent_id,
      agent_name: agent.name,
      agent_slug: agent.slug,
      agent_description: agent.description,
      elo: r.elo,
      matches_played: r.matches_played,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
    };

    const existing = divisionMap.get(r.capability);
    if (existing) {
      existing.push(entry);
    } else {
      divisionMap.set(r.capability, [entry]);
    }
  }

  // Sort each division by ELO desc (already ordered from DB but after grouping)
  const divisions: Record<
    string,
    Array<{
      rank: number;
      agent_id: string;
      agent_name: string;
      agent_slug: string;
      agent_description: string | null;
      elo: number;
      matches_played: number;
      wins: number;
      losses: number;
      ties: number;
    }>
  > = {};

  for (const [cap, entries] of divisionMap) {
    entries.sort((a, b) => b.elo - a.elo);
    divisions[cap] = entries.map((e, i) => ({ rank: i + 1, ...e }));
  }

  // ── 3. Build overall (P4P) rankings — average ELO per agent ──────
  const agentAgg = new Map<
    string,
    {
      agent_id: string;
      agent_name: string;
      agent_slug: string;
      agent_description: string | null;
      total_elo: number;
      capability_count: number;
      total_matches: number;
      total_wins: number;
      total_losses: number;
      total_ties: number;
    }
  >();

  for (const r of ratings ?? []) {
    const agent = r.agent as unknown as { id: string; name: string; slug: string; description: string | null } | null;
    if (!agent) continue;

    const existing = agentAgg.get(r.agent_id);
    if (existing) {
      existing.total_elo += r.elo;
      existing.capability_count += 1;
      existing.total_matches += r.matches_played;
      existing.total_wins += r.wins;
      existing.total_losses += r.losses;
      existing.total_ties += r.ties;
    } else {
      agentAgg.set(r.agent_id, {
        agent_id: r.agent_id,
        agent_name: agent.name,
        agent_slug: agent.slug,
        agent_description: agent.description,
        total_elo: r.elo,
        capability_count: 1,
        total_matches: r.matches_played,
        total_wins: r.wins,
        total_losses: r.losses,
        total_ties: r.ties,
      });
    }
  }

  const rankings = Array.from(agentAgg.values())
    .map((a) => ({
      rank: 0,
      agent_id: a.agent_id,
      agent_name: a.agent_name,
      agent_slug: a.agent_slug,
      agent_description: a.agent_description,
      avg_elo: Math.round(a.total_elo / a.capability_count),
      capabilities: a.capability_count,
      matches_played: a.total_matches,
      wins: a.total_wins,
      losses: a.total_losses,
      ties: a.total_ties,
    }))
    .sort((a, b) => b.avg_elo - a.avg_elo)
    .map((a, i) => ({ ...a, rank: i + 1 }));

  // ── 4. Recent completed matches (last 5) ─────────────────────────
  const { data: recentMatches, error: matchErr } = await admin
    .from("arena_matches")
    .select(
      `
      id,
      capability,
      status,
      match_type,
      winner,
      votes_a,
      votes_b,
      votes_tie,
      completed_at,
      created_at,
      agent_a:agents!arena_matches_agent_a_id_fkey(name, slug),
      agent_b:agents!arena_matches_agent_b_id_fkey(name, slug)
      `
    )
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(5);

  if (matchErr) {
    console.error("[arena/leaderboard] Matches query error:", matchErr);
  }

  // ── 5. Aggregate stats ───────────────────────────────────────────
  const totalAgents = rankings.length;
  const totalMatches = rankings.reduce((sum, r) => sum + r.matches_played, 0) / 2; // each match counted for 2 agents
  const avgElo =
    rankings.length > 0
      ? Math.round(rankings.reduce((sum, r) => sum + r.avg_elo, 0) / rankings.length)
      : 1500;

  return NextResponse.json({
    rankings,
    divisions,
    recentMatches: recentMatches ?? [],
    stats: {
      total_agents: totalAgents,
      total_matches: Math.round(totalMatches),
      avg_elo: avgElo,
      total_capabilities: divisionMap.size,
    },
  });
}
