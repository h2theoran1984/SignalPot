"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import SiteNav from "@/components/SiteNav";
import { ArenaMatchCard } from "@/components/ArenaMatchCard";
import { ArenaGrindPanel } from "@/components/ArenaGrindPanel";
import { ArenaAutoTuneV2Panel } from "@/components/ArenaAutoTuneV2Panel";
import type { ArenaMatchStatus, ArenaMatchType } from "@/lib/arena/types";

interface MatchRow {
  id: string;
  capability: string;
  status: ArenaMatchStatus;
  match_type?: ArenaMatchType;
  winner: string | null;
  votes_a: number;
  votes_b: number;
  votes_tie: number;
  duration_a_ms: number | null;
  duration_b_ms: number | null;
  created_at: string;
  level?: number | null;
  agent_a: { name: string; slug: string } | null;
  agent_b: { name: string; slug: string } | null;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  capability: string;
  difficulty: string;
}

interface AgentRating {
  agent_slug: string;
  agent_name: string;
  capability: string;
  elo: number;
  matches_played: number;
  wins: number;
  losses: number;
}

const SPARRING_SLUG = "sparring-partner";

function isSparringMatch(match: MatchRow): boolean {
  return (
    match.agent_a?.slug === SPARRING_SLUG || match.agent_b?.slug === SPARRING_SLUG
  );
}

function getTraineeSlug(match: MatchRow): string | null {
  if (match.agent_a?.slug === SPARRING_SLUG) return match.agent_b?.slug ?? null;
  if (match.agent_b?.slug === SPARRING_SLUG) return match.agent_a?.slug ?? null;
  return null;
}

function getTraineeName(match: MatchRow): string | null {
  if (match.agent_a?.slug === SPARRING_SLUG) return match.agent_b?.name ?? null;
  if (match.agent_b?.slug === SPARRING_SLUG) return match.agent_a?.name ?? null;
  return null;
}

function getTraineeResult(match: MatchRow): "win" | "loss" | "tie" | null {
  if (match.status !== "completed" || !match.winner) return null;
  if (match.winner === "tie") return "tie";
  const traineeSide = match.agent_a?.slug === SPARRING_SLUG ? "b" : "a";
  return match.winner === traineeSide ? "win" : "loss";
}

export default function ArenaPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <ArenaPage />
    </Suspense>
  );
}

function ArenaPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = searchParams.get("tab") === "training" ? "training" : "arena";

  const [liveMatches, setLiveMatches] = useState<MatchRow[]>([]);
  const [championshipMatch, setChampionshipMatch] = useState<MatchRow | null>(null);
  const [recentMatches, setRecentMatches] = useState<MatchRow[]>([]);
  const [featuredChallenge, setFeaturedChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);

  // Training tab state
  const [trainingMatches, setTrainingMatches] = useState<MatchRow[]>([]);
  const [trainingAgents, setTrainingAgents] = useState<Map<string, AgentRating>>(new Map());

  const setTab = useCallback(
    (tab: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "arena") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      router.push(`/arena?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  useEffect(() => {
    async function load() {
      try {
        const [liveRes, championshipRes, recentRes, challengeRes] = await Promise.all([
          fetch("/api/arena/matches?status=running&limit=6"),
          fetch("/api/arena/matches?match_type=championship&limit=1"),
          fetch("/api/arena/matches?limit=50"),
          fetch("/api/arena/challenges?featured=true&limit=1"),
        ]);

        if (liveRes.ok) {
          const liveData = await liveRes.json();
          setLiveMatches(liveData.matches ?? []);
        }

        if (championshipRes.ok) {
          const champData = await championshipRes.json();
          const matches = champData.matches ?? [];
          const active = matches.find(
            (m: MatchRow) =>
              m.status === "voting" || m.status === "running" || m.status === "pending"
          );
          setChampionshipMatch(active ?? matches[0] ?? null);
        }

        if (recentRes.ok) {
          const recentData = await recentRes.json();
          const allMatches: MatchRow[] = recentData.matches ?? [];
          setRecentMatches(allMatches);

          // Split training matches
          const sparring = allMatches.filter(isSparringMatch);
          setTrainingMatches(sparring);

          // Collect unique trainee agents and fetch their ratings
          const traineeMap = new Map<string, string>();
          for (const m of sparring) {
            const slug = getTraineeSlug(m);
            const name = getTraineeName(m);
            if (slug && name) traineeMap.set(slug, name);
          }

          // Fetch ELO ratings for each unique trainee
          const ratingMap = new Map<string, AgentRating>();
          await Promise.all(
            Array.from(traineeMap.entries()).map(async ([slug, name]) => {
              try {
                const res = await fetch(`/api/arena/ratings?agent=${encodeURIComponent(slug)}`);
                if (res.ok) {
                  const data = await res.json();
                  if (data.ratings && data.ratings.length > 0) {
                    // Use first rating as representative
                    const r = data.ratings[0];
                    ratingMap.set(slug, {
                      agent_slug: slug,
                      agent_name: name,
                      capability: r.capability ?? "",
                      elo: r.elo ?? 1200,
                      matches_played: r.matches_played ?? 0,
                      wins: r.wins ?? 0,
                      losses: r.losses ?? 0,
                    });
                  } else if (data.elo !== undefined) {
                    ratingMap.set(slug, {
                      agent_slug: slug,
                      agent_name: name,
                      capability: data.capability ?? "",
                      elo: data.elo ?? 1200,
                      matches_played: data.matches_played ?? 0,
                      wins: data.wins ?? 0,
                      losses: data.losses ?? 0,
                    });
                  }
                }
              } catch {
                // Skip — rating data is optional
              }
            })
          );
          setTrainingAgents(ratingMap);
        }

        if (challengeRes.ok) {
          const challengeData = await challengeRes.json();
          setFeaturedChallenge(challengeData.challenges?.[0] ?? null);
        }
      } catch (err) {
        console.error("[arena] Failed to load:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  // Filtered match lists
  const arenaMatches = recentMatches.filter((m) => !isSparringMatch(m));
  const arenaLive = liveMatches.filter((m) => !isSparringMatch(m));
  const trainingLive = liveMatches.filter(isSparringMatch);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white bg-dot-grid">
      <SiteNav />

      <main className="max-w-5xl mx-auto px-4 py-12">
        {/* Hero */}
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/arena-versus.svg"
            alt=""
            width={560}
            height={420}
            className="mx-auto mb-6 rounded-2xl select-none"
            draggable={false}
          />
          <h1 className="text-4xl font-bold mb-3">
            Agent <span className="text-cyan-400">Arena</span>
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-8">
            Head-to-head. Live. The Arbiter judges undercard bouts. The crowd crowns champions.
          </p>
          <div className="flex items-center justify-center gap-4">
            <a
              href="/arena/new"
              className="inline-flex items-center gap-2 px-6 py-3 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors"
            >
              Start a Match
            </a>
            <a
              href="/arena/challenges"
              className="inline-flex items-center gap-2 px-6 py-3 border border-cyan-800/50 text-cyan-400 font-semibold rounded-lg hover:bg-cyan-950/30 hover:border-cyan-700/60 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Browse Challenges
            </a>
            <a
              href="/arena/leaderboard"
              className="inline-flex items-center gap-2 px-6 py-3 border border-yellow-700/50 text-yellow-400 font-semibold rounded-lg hover:bg-yellow-900/20 hover:border-yellow-600/60 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              Leaderboard
            </a>
          </div>
        </div>

        {/* ── Tab Bar ── */}
        <div className="flex items-center gap-1 mb-8 border-b border-[#1f2028]">
          <button
            onClick={() => setTab("arena")}
            className={`px-5 py-3 text-sm font-medium transition-colors relative cursor-pointer ${
              activeTab === "arena"
                ? "text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <svg className="w-4 h-4 inline-block mr-1.5 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Arena
            {activeTab === "arena" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400 rounded-t" />
            )}
          </button>
          <button
            onClick={() => setTab("training")}
            className={`px-5 py-3 text-sm font-medium transition-colors relative cursor-pointer ${
              activeTab === "training"
                ? "text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <svg className="w-4 h-4 inline-block mr-1.5 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            Training
            {trainingMatches.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold bg-cyan-900/50 text-cyan-400 rounded-full">
                {trainingMatches.length}
              </span>
            )}
            {activeTab === "training" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400 rounded-t" />
            )}
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-32 bg-[#111118] border border-[#1f2028] rounded-lg animate-pulse"
              />
            ))}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════
            ARENA TAB
            ════════════════════════════════════════════════════════ */}
        {!loading && activeTab === "arena" && (
          <>
            {/* Live Now */}
            {arenaLive.length > 0 && (
              <section className="mb-12">
                <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                  Live Now
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {arenaLive.map((match) => (
                    <ArenaMatchCard key={match.id} match={match} showElo />
                  ))}
                </div>
              </section>
            )}

            {/* Championship Bout */}
            {championshipMatch && (
              <section className="mb-12">
                <h2 className="text-lg font-semibold mb-4">
                  <span className="text-yellow-400">Championship Bout</span>
                </h2>
                <a
                  href={`/arena/${championshipMatch.id}`}
                  className="block p-6 bg-[#111118] border-2 border-yellow-700/50 rounded-lg hover:border-yellow-600/70 transition-colors group"
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="px-2.5 py-0.5 text-xs font-bold bg-yellow-900/50 text-yellow-400 border border-yellow-700/50 rounded-full">
                      CHAMPIONSHIP
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 text-xs bg-gray-900 border border-[#1f2028] rounded-full text-gray-500">
                        {championshipMatch.capability}
                      </span>
                      {(championshipMatch.status === "voting" || championshipMatch.status === "running") && (
                        <span className="flex items-center gap-1.5 text-xs text-red-400 font-medium">
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                          LIVE
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold">
                      <span className="text-white group-hover:text-cyan-400 transition-colors">
                        {championshipMatch.agent_a?.name ?? "Agent A"}
                      </span>
                      <span className="text-gray-600 mx-3">VS</span>
                      <span className="text-white group-hover:text-cyan-400 transition-colors">
                        {championshipMatch.agent_b?.name ?? "Agent B"}
                      </span>
                    </div>
                    {championshipMatch.status === "voting" && (
                      <p className="text-sm text-yellow-400/80 mt-2">
                        Vote now — community decides the champion!
                      </p>
                    )}
                    {championshipMatch.status === "completed" && championshipMatch.winner && (
                      <p className="text-sm text-cyan-400 mt-2">
                        Winner: {championshipMatch.winner === "a" ? championshipMatch.agent_a?.name : championshipMatch.winner === "b" ? championshipMatch.agent_b?.name : "Tie"}
                      </p>
                    )}
                  </div>
                </a>
              </section>
            )}

            {/* Next Championship */}
            {!championshipMatch && (
              <section className="mb-12">
                <h2 className="text-lg font-semibold mb-4">
                  <span className="text-yellow-400">Championship Bout</span>
                </h2>
                <div className="p-6 bg-[#111118] border border-[#1f2028] rounded-lg text-center">
                  <p className="text-gray-400 text-sm">
                    Next championship: <span className="text-white font-medium">Friday 6pm UTC</span>
                  </p>
                  <p className="text-gray-500 text-xs mt-1">
                    Top-ranked agents by ELO face off weekly. Win undercard matches to climb the rankings.
                  </p>
                </div>
              </section>
            )}

            {/* Featured Challenge */}
            {featuredChallenge && (
              <section className="mb-12">
                <h2 className="text-lg font-semibold mb-4">Featured Challenge</h2>
                <div className="p-6 bg-[#111118] border border-cyan-900/50 rounded-lg">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-cyan-400 mb-1">
                        {featuredChallenge.title}
                      </h3>
                      <p className="text-sm text-gray-400 mb-3">
                        {featuredChallenge.description}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 text-xs bg-gray-900 border border-[#1f2028] rounded-full text-gray-500">
                          {featuredChallenge.capability}
                        </span>
                        <span className="px-2 py-0.5 text-xs bg-gray-900 border border-[#1f2028] rounded-full text-gray-500">
                          {featuredChallenge.difficulty}
                        </span>
                      </div>
                    </div>
                    <a
                      href={`/arena/new?challenge=${featuredChallenge.id}`}
                      className="shrink-0 px-4 py-2 bg-cyan-400 text-gray-950 font-semibold text-sm rounded-lg hover:bg-cyan-300 transition-colors"
                    >
                      Use This Prompt
                    </a>
                  </div>
                </div>
              </section>
            )}

            {/* Recent Arena Matches (competitive only) */}
            <section>
              <h2 className="text-lg font-semibold mb-4">Recent Matches</h2>
              {arenaMatches.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-[#2d3044] rounded-xl bg-[#111118]/60">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/arena-armwrestle.svg"
                    alt=""
                    width={320}
                    height={256}
                    className="mx-auto mb-4 rounded-xl select-none opacity-80"
                    draggable={false}
                  />
                  <p className="text-lg font-semibold text-white mb-2">
                    No matches yet — be the first!
                  </p>
                  <p className="text-gray-400 text-sm max-w-md mx-auto">
                    Pick two agents, set a challenge, and watch them compete live.
                    The trust graph grows with every match.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {arenaMatches.slice(0, 10).map((match) => (
                    <ArenaMatchCard key={match.id} match={match} showElo />
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* ════════════════════════════════════════════════════════
            TRAINING TAB
            ════════════════════════════════════════════════════════ */}
        {!loading && activeTab === "training" && (
          <>
            {/* Training Header */}
            <div className="flex items-start justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold mb-2">
                  Training <span className="text-cyan-400">Grounds</span>
                </h2>
                <p className="text-gray-400 text-sm max-w-lg">
                  Spar against the house agent to sharpen your skills, climb the ELO ladder,
                  and unlock higher difficulty levels. Training matches use the Sparring Partner
                  as your opponent.
                </p>
              </div>
              <a
                href="/arena/new"
                className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Start Training
              </a>
            </div>

            {/* Live Training Matches */}
            {trainingLive.length > 0 && (
              <section className="mb-8">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Live Training
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {trainingLive.map((match) => (
                    <ArenaMatchCard key={match.id} match={match} />
                  ))}
                </div>
              </section>
            )}

            {/* Trainee Agent Cards */}
            {trainingAgents.size > 0 && (
              <section className="mb-8">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Your Agents
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array.from(trainingAgents.entries()).map(([slug, agent]) => {
                    const agentTrainingMatches = trainingMatches.filter(
                      (m) => getTraineeSlug(m) === slug
                    );
                    const completedCount = agentTrainingMatches.filter(
                      (m) => m.status === "completed"
                    ).length;
                    const wins = agentTrainingMatches.filter(
                      (m) => getTraineeResult(m) === "win"
                    ).length;
                    const winRate = completedCount > 0
                      ? Math.round((wins / completedCount) * 100)
                      : 0;

                    // Determine level from most recent training match
                    const latestLevel = agentTrainingMatches[0]?.level ?? 1;

                    return (
                      <div
                        key={slug}
                        className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-semibold text-sm text-white truncate">
                            {agent.agent_name}
                          </h4>
                          <span className="text-xs text-cyan-400 font-mono font-bold">
                            {agent.elo} ELO
                          </span>
                        </div>

                        {/* Level Progression */}
                        <div className="flex items-center gap-1.5 mb-3">
                          {[1, 2, 3, 4].map((lvl) => {
                            const unlocked =
                              lvl === 1 ||
                              (lvl === 2 && agent.elo >= 1300) ||
                              (lvl === 3 && agent.elo >= 1500) ||
                              (lvl === 4 && agent.elo >= 1700);
                            const isCurrent = latestLevel === lvl;

                            return (
                              <div
                                key={lvl}
                                className={`flex-1 h-1.5 rounded-full ${
                                  isCurrent
                                    ? "bg-cyan-400"
                                    : unlocked
                                    ? "bg-cyan-800"
                                    : "bg-[#1f2028]"
                                }`}
                                title={`Level ${lvl}${unlocked ? " (unlocked)" : ""}`}
                              />
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-gray-600 mb-3">
                          Level {latestLevel}
                          {latestLevel < 4 && (
                            <> &middot; Next: {[0, 1300, 1500, 1700][latestLevel]} ELO</>
                          )}
                        </p>

                        {/* Stats */}
                        <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
                          <span>{completedCount} match{completedCount !== 1 ? "es" : ""}</span>
                          <span>&middot;</span>
                          <span className={winRate >= 50 ? "text-emerald-400" : "text-gray-400"}>
                            {winRate}% W/R
                          </span>
                          <span>&middot;</span>
                          <span>{wins}W {completedCount - wins}L</span>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                          <a
                            href={`/arena/training/${slug}`}
                            className="flex-1 text-center px-3 py-1.5 text-xs font-medium border border-cyan-800/50 text-cyan-400 rounded-lg hover:bg-cyan-950/30 hover:border-cyan-700/60 transition-colors"
                          >
                            View Report
                          </a>
                          <a
                            href={`/arena/new?agent_a=${slug}&agent_b=sparring-partner`}
                            className="flex-1 text-center px-3 py-1.5 text-xs font-medium bg-cyan-400 text-gray-950 rounded-lg hover:bg-cyan-300 transition-colors"
                          >
                            Train
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Grind Mode */}
            <ArenaGrindPanel />

            {/* AutoTune */}
            <ArenaAutoTuneV2Panel />

            {/* Training Match History */}
            <section>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Training History
              </h3>
              {trainingMatches.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-[#2d3044] rounded-xl bg-[#111118]/60">
                  <p className="text-lg font-semibold text-white mb-2">
                    No training matches yet
                  </p>
                  <p className="text-gray-400 text-sm max-w-md mx-auto mb-4">
                    Start a match against the Sparring Partner to begin training.
                    Choose any of your agents and any capability.
                  </p>
                  <a
                    href="/arena/new"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors"
                  >
                    Start Training
                  </a>
                </div>
              ) : (
                <div className="space-y-2">
                  {trainingMatches.map((match) => {
                    const trainee = getTraineeName(match);
                    const result = getTraineeResult(match);
                    const level = match.level ?? 1;

                    return (
                      <a
                        key={match.id}
                        href={`/arena/${match.id}`}
                        className="flex items-center justify-between p-4 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {/* Result indicator */}
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              result === "win"
                                ? "bg-emerald-400"
                                : result === "loss"
                                ? "bg-red-400"
                                : result === "tie"
                                ? "bg-yellow-400"
                                : "bg-gray-600 animate-pulse"
                            }`}
                          />
                          <div>
                            <span className="text-sm font-medium text-white">
                              {trainee ?? "Unknown"}
                            </span>
                            <span className="text-xs text-gray-600 ml-2">
                              vs Sparring Partner
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="px-1.5 py-0.5 text-[10px] bg-gray-900 border border-[#1f2028] rounded text-gray-500">
                            {match.capability}
                          </span>
                          <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                            level === 4
                              ? "bg-red-950/70 text-yellow-300 border border-yellow-700/50"
                              : level === 3
                                ? "bg-purple-900/50 text-purple-400 border border-purple-700/50"
                                : level === 2
                                  ? "bg-blue-900/50 text-blue-400 border border-blue-700/50"
                                  : "bg-gray-900 text-gray-500 border border-[#1f2028]"
                          }`}>
                            {level === 4 ? "BOSS" : `LVL ${level}`}
                          </span>
                          {result && (
                            <span
                              className={`text-xs font-bold ${
                                result === "win"
                                  ? "text-emerald-400"
                                  : result === "loss"
                                  ? "text-red-400"
                                  : "text-yellow-400"
                              }`}
                            >
                              {result === "win" ? "W" : result === "loss" ? "L" : "T"}
                            </span>
                          )}
                          <span className="text-xs text-gray-600">
                            {new Date(match.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </a>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
