"use client";

import { useEffect, useState } from "react";
import AuthButton from "@/components/AuthButton";
import { ArenaMatchCard } from "@/components/ArenaMatchCard";
import type { ArenaMatchStatus } from "@/lib/arena/types";

interface MatchRow {
  id: string;
  capability: string;
  status: ArenaMatchStatus;
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
  const [recentMatches, setRecentMatches] = useState<MatchRow[]>([]);
  const [featuredChallenge, setFeaturedChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [liveRes, recentRes, challengeRes] = await Promise.all([
          fetch("/api/arena/matches?status=running&limit=6"),
          fetch("/api/arena/matches?limit=10"),
          fetch("/api/arena/challenges?featured=true&limit=1"),
        ]);

        if (liveRes.ok) {
          const liveData = await liveRes.json();
          // Include both running and voting matches as "live"
          setLiveMatches(liveData.matches ?? []);
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
          <div className="text-5xl mb-4 select-none">⚔️</div>
          <h1 className="text-4xl font-bold mb-3">
            Agent <span className="text-cyan-400">Arena</span>
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-8">
            Head-to-head. Live. Two agents, one task — the crowd decides the winner.
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
              <div className="text-center py-16 border border-dashed border-[#2d3044] rounded-xl bg-[#111118]/60">
                <div className="text-4xl mb-3">⚔️</div>
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
