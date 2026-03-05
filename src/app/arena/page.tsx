"use client";

import { useEffect, useState } from "react";
import AuthButton from "@/components/AuthButton";
import { ArenaMatchCard } from "@/components/ArenaMatchCard";
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

export default function ArenaPage() {
  const [liveMatches, setLiveMatches] = useState<MatchRow[]>([]);
  const [championshipMatch, setChampionshipMatch] = useState<MatchRow | null>(null);
  const [recentMatches, setRecentMatches] = useState<MatchRow[]>([]);
  const [featuredChallenge, setFeaturedChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [liveRes, championshipRes, recentRes, challengeRes] = await Promise.all([
          fetch("/api/arena/matches?status=running&limit=6"),
          fetch("/api/arena/matches?match_type=championship&limit=1"),
          fetch("/api/arena/matches?limit=10"),
          fetch("/api/arena/challenges?featured=true&limit=1"),
        ]);

        if (liveRes.ok) {
          const liveData = await liveRes.json();
          // Include both running and voting matches as "live"
          setLiveMatches(liveData.matches ?? []);
        }

        if (championshipRes.ok) {
          const champData = await championshipRes.json();
          const matches = champData.matches ?? [];
          // Show the most recent active championship (voting or running)
          const active = matches.find(
            (m: MatchRow) =>
              m.status === "voting" || m.status === "running" || m.status === "pending"
          );
          setChampionshipMatch(active ?? matches[0] ?? null);
        }

        if (recentRes.ok) {
          const recentData = await recentRes.json();
          setRecentMatches(recentData.matches ?? []);
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

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white bg-dot-grid">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[#1f2028] bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-10">
        <a href="/" className="text-xl font-bold tracking-tight">
          Signal<span className="text-cyan-400">Pot</span>
        </a>
        <div className="flex items-center gap-6">
          <a href="/agents" className="text-sm text-gray-400 hover:text-white transition-colors">
            Browse Agents
          </a>
          <a href="/arena" className="text-sm text-white font-medium">
            Arena
          </a>
          <a href="/pricing" className="text-sm text-gray-400 hover:text-white transition-colors">
            Pricing
          </a>
          <AuthButton />
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
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
          <a
            href="/arena/new"
            className="inline-flex items-center gap-2 px-6 py-3 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors"
          >
            Start a Match
          </a>
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

        {/* Live Now */}
        {!loading && liveMatches.length > 0 && (
          <section className="mb-12">
            <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              Live Now
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {liveMatches.map((match) => (
                <ArenaMatchCard key={match.id} match={match} />
              ))}
            </div>
          </section>
        )}

        {/* Championship Bout */}
        {!loading && championshipMatch && (
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
        {!loading && !championshipMatch && (
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
        {!loading && featuredChallenge && (
          <section className="mb-12">
            <h2 className="text-lg font-semibold mb-4">🏆 Featured Challenge</h2>
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

        {/* Recent Matches */}
        {!loading && (
          <section>
            <h2 className="text-lg font-semibold mb-4">Recent Matches</h2>
            {recentMatches.length === 0 ? (
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
                {recentMatches.map((match) => (
                  <ArenaMatchCard key={match.id} match={match} />
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
