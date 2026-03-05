"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import AuthButton from "@/components/AuthButton";
import { Badge } from "@/components/ui/badge";
import type { ArenaMatchStatus, ArenaStreamEvent, ArenaVoteChoice } from "@/lib/arena/types";

interface MatchDetail {
  id: string;
  capability: string;
  prompt: Record<string, unknown>;
  prompt_text: string | null;
  status: ArenaMatchStatus;
  winner: string | null;
  votes_a: number;
  votes_b: number;
  votes_tie: number;
  voting_ends_at: string | null;
  response_a: Record<string, unknown> | null;
  response_b: Record<string, unknown> | null;
  duration_a_ms: number | null;
  duration_b_ms: number | null;
  verified_a: boolean | null;
  verified_b: boolean | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  cost_a: number;
  cost_b: number;
  agent_a: { id: string; name: string; slug: string; description: string | null } | null;
  agent_b: { id: string; name: string; slug: string; description: string | null } | null;
  challenge: { title: string; description: string } | null;
  viewer_vote: ArenaVoteChoice | null;
}

function ResponsePanel({
  side,
  agentName,
  agentSlug,
  status,
  response,
  durationMs,
  verified,
  isWinner,
}: {
  side: "A" | "B";
  agentName: string;
  agentSlug: string;
  status: ArenaMatchStatus;
  response: Record<string, unknown> | null;
  durationMs: number | null;
  verified: boolean | null;
  isWinner: boolean;
}) {
  const isRunning = status === "running" && !response;
  const hasResponse = !!response;

  return (
    <div
      className={`p-5 bg-[#111118] border rounded-lg transition-colors ${
        isWinner ? "border-cyan-700 glow-cyan-sm" : "border-[#1f2028]"
      }`}
    >
      {/* Agent header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 font-bold">{side}</span>
            <h3 className="font-semibold text-white">{agentName}</h3>
            {isWinner && (
              <span className="text-xs text-cyan-400 font-medium">👑 Winner</span>
            )}
          </div>
          <a href={`/agents/${agentSlug}`} className="text-xs text-gray-500 hover:text-gray-400 transition-colors">
            /{agentSlug}
          </a>
        </div>
        <div className="flex items-center gap-2">
          {durationMs !== null && (
            <span className="text-xs text-gray-500">
              {(durationMs / 1000).toFixed(2)}s
            </span>
          )}
          {verified !== null && (
            <Badge variant="status" status={verified ? "completed" : "failed"}>
              {verified ? "Verified" : "Unverified"}
            </Badge>
          )}
        </div>
      </div>

      {/* Response area */}
      <div className="min-h-[200px]">
        {isRunning && (
          <div className="flex items-center justify-center h-48">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-500">Calling agent...</p>
            </div>
          </div>
        )}

        {!isRunning && !hasResponse && status !== "running" && (
          <div className="flex items-center justify-center h-48">
            <p className="text-sm text-gray-600">
              {status === "failed" ? "Agent failed to respond" : "Waiting..."}
            </p>
          </div>
        )}

        {hasResponse && (
          <pre className="p-3 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-xs text-gray-300 font-mono overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap">
            {JSON.stringify(response, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [voting, setVoting] = useState(false);
  const [viewerVote, setViewerVote] = useState<ArenaVoteChoice | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch initial match data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/arena/matches/${id}`);
        if (!res.ok) {
          setError("Match not found");
          setLoading(false);
          return;
        }
        const data = await res.json();
        setMatch(data.match);
        setViewerVote(data.match.viewer_vote ?? null);
      } catch {
        setError("Failed to load match");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  // SSE streaming for live matches
  const handleStreamEvent = useCallback((event: ArenaStreamEvent) => {
    setMatch((prev) => {
      if (!prev) return prev;

      switch (event.type) {
        case "match_started":
          return { ...prev, status: "running", started_at: event.started_at };

        case "agent_response":
          if (event.side === "a") {
            return {
              ...prev,
              response_a: event.response,
              duration_a_ms: event.duration_ms,
              verified_a: event.verified,
            };
          } else {
            return {
              ...prev,
              response_b: event.response,
              duration_b_ms: event.duration_ms,
              verified_b: event.verified,
            };
          }

        case "voting_open":
          return { ...prev, status: "voting", voting_ends_at: event.voting_ends_at };

        case "match_completed":
          return {
            ...prev,
            status: "completed",
            winner: event.winner,
            votes_a: event.votes_a,
            votes_b: event.votes_b,
            votes_tie: event.votes_tie,
          };

        case "match_failed":
          return { ...prev, status: "failed" };

        default:
          return prev;
      }
    });
  }, []);

  useEffect(() => {
    if (!match) return;
    if (match.status === "completed" || match.status === "failed") return;

    const es = new EventSource(`/api/arena/matches/${id}/stream`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ArenaStreamEvent;
        handleStreamEvent(data);
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [id, match?.status, handleStreamEvent]);

  // Vote handler
  async function handleVote(vote: ArenaVoteChoice) {
    setVoting(true);
    try {
      const res = await fetch(`/api/arena/matches/${id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote }),
      });

      if (res.ok) {
        const data = await res.json();
        setViewerVote(vote);
        setMatch((prev) =>
          prev
            ? {
                ...prev,
                votes_a: data.votes_a,
                votes_b: data.votes_b,
                votes_tie: data.votes_tie,
              }
            : prev
        );
      }
    } catch {
      // Vote failed silently
    } finally {
      setVoting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !match) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center">
        <p className="text-xl font-bold mb-4">{error || "Match not found"}</p>
        <a href="/arena" className="text-cyan-400 hover:text-cyan-300 transition-colors">
          &larr; Back to Arena
        </a>
      </div>
    );
  }

  const agentAName = match.agent_a?.name ?? "Agent A";
  const agentBName = match.agent_b?.name ?? "Agent B";
  const totalVotes = match.votes_a + match.votes_b + match.votes_tie;
  const isLive = match.status === "pending" || match.status === "running";
  const isVoting = match.status === "voting";
  const isCompleted = match.status === "completed";
  const isFailed = match.status === "failed";

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white bg-dot-grid">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[#1f2028] bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-10">
        <a href="/" className="text-xl font-bold tracking-tight">
          Signal<span className="text-cyan-400">Pot</span>
        </a>
        <div className="flex items-center gap-6">
          <a href="/arena" className="text-sm text-gray-400 hover:text-white transition-colors">
            Arena
          </a>
          <AuthButton />
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Match header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-4 mb-3">
            <Badge variant="tag">{match.capability}</Badge>
            <div className="flex items-center gap-2">
              {isLive && (
                <span className="flex items-center gap-1.5 text-xs text-red-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  LIVE
                </span>
              )}
              <Badge variant="status" status={match.status as "pending" | "running" | "completed" | "failed"}>
                {match.status === "voting" ? "Voting Open" : match.status.charAt(0).toUpperCase() + match.status.slice(1)}
              </Badge>
            </div>
          </div>
          <h1 className="text-2xl font-bold">
            <span className={isCompleted && match.winner === "a" ? "text-cyan-400" : "text-white"}>
              {agentAName}
            </span>
            <span className="text-gray-600 mx-3">VS</span>
            <span className={isCompleted && match.winner === "b" ? "text-cyan-400" : "text-white"}>
              {agentBName}
            </span>
          </h1>
        </div>

        {/* Split screen */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <ResponsePanel
            side="A"
            agentName={agentAName}
            agentSlug={match.agent_a?.slug ?? ""}
            status={match.status}
            response={match.response_a}
            durationMs={match.duration_a_ms}
            verified={match.verified_a}
            isWinner={isCompleted && match.winner === "a"}
          />
          <ResponsePanel
            side="B"
            agentName={agentBName}
            agentSlug={match.agent_b?.slug ?? ""}
            status={match.status}
            response={match.response_b}
            durationMs={match.duration_b_ms}
            verified={match.verified_b}
            isWinner={isCompleted && match.winner === "b"}
          />
        </div>

        {/* Prompt display */}
        <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg mb-8">
          <h3 className="text-sm font-medium text-gray-400 mb-2">
            {match.challenge ? `Challenge: ${match.challenge.title}` : "Prompt"}
          </h3>
          {match.prompt_text && (
            <p className="text-sm text-gray-300 mb-2">{match.prompt_text}</p>
          )}
          <pre className="text-xs text-gray-500 font-mono overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(match.prompt, null, 2)}
          </pre>
        </div>

        {/* Voting section */}
        {isVoting && !viewerVote && (
          <div className="p-6 bg-[#111118] border border-cyan-900/50 rounded-lg mb-8 text-center">
            <h3 className="text-lg font-semibold mb-2">Who did it better?</h3>
            <p className="text-sm text-gray-400 mb-4">
              {match.voting_ends_at && (
                <>Voting closes {new Date(match.voting_ends_at).toLocaleString()}</>
              )}
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => handleVote("a")}
                disabled={voting}
                className="px-6 py-3 bg-[#0a0a0f] border border-[#1f2028] rounded-lg hover:border-cyan-700 transition-colors text-sm font-medium disabled:opacity-50 cursor-pointer"
              >
                {agentAName}
              </button>
              <button
                onClick={() => handleVote("tie")}
                disabled={voting}
                className="px-6 py-3 bg-[#0a0a0f] border border-[#1f2028] rounded-lg hover:border-yellow-700 transition-colors text-sm font-medium disabled:opacity-50 cursor-pointer"
              >
                Tie
              </button>
              <button
                onClick={() => handleVote("b")}
                disabled={voting}
                className="px-6 py-3 bg-[#0a0a0f] border border-[#1f2028] rounded-lg hover:border-cyan-700 transition-colors text-sm font-medium disabled:opacity-50 cursor-pointer"
              >
                {agentBName}
              </button>
            </div>
          </div>
        )}

        {/* Vote submitted confirmation */}
        {isVoting && viewerVote && (
          <div className="p-4 bg-[#111118] border border-emerald-900/50 rounded-lg mb-8 text-center">
            <p className="text-sm text-emerald-400">
              ✓ You voted for {viewerVote === "a" ? agentAName : viewerVote === "b" ? agentBName : "Tie"}
            </p>
          </div>
        )}

        {/* Vote results */}
        {(isVoting || isCompleted) && totalVotes > 0 && (
          <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg mb-8">
            <h3 className="text-sm font-medium text-gray-400 mb-3">
              Votes ({totalVotes})
            </h3>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-gray-500 w-20 text-right">{agentAName}</span>
              <div className="flex-1 h-6 bg-[#0a0a0f] rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-700 rounded-full transition-all duration-500"
                  style={{ width: `${totalVotes > 0 ? (match.votes_a / totalVotes) * 100 : 0}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 w-10">{match.votes_a}</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-gray-500 w-20 text-right">Tie</span>
              <div className="flex-1 h-6 bg-[#0a0a0f] rounded-full overflow-hidden">
                <div
                  className="h-full bg-yellow-700 rounded-full transition-all duration-500"
                  style={{ width: `${totalVotes > 0 ? (match.votes_tie / totalVotes) * 100 : 0}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 w-10">{match.votes_tie}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-20 text-right">{agentBName}</span>
              <div className="flex-1 h-6 bg-[#0a0a0f] rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-700 rounded-full transition-all duration-500"
                  style={{ width: `${totalVotes > 0 ? (match.votes_b / totalVotes) * 100 : 0}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 w-10">{match.votes_b}</span>
            </div>
          </div>
        )}

        {/* Winner announcement */}
        {isCompleted && match.winner && (
          <div className="p-6 bg-[#111118] border border-cyan-900/50 rounded-lg mb-8 text-center glow-cyan-sm">
            <div className="text-3xl mb-2">👑</div>
            <h3 className="text-xl font-bold text-cyan-400 mb-1">
              {match.winner === "a" ? agentAName : match.winner === "b" ? agentBName : "It's a Tie!"}
            </h3>
            {match.winner !== "tie" && (
              <p className="text-sm text-gray-400">wins this round</p>
            )}
          </div>
        )}

        {/* Failed state */}
        {isFailed && (
          <div className="p-6 bg-[#111118] border border-red-900/50 rounded-lg mb-8 text-center">
            <div className="text-3xl mb-2">💥</div>
            <h3 className="text-lg font-bold text-red-400 mb-1">Match Failed</h3>
            <p className="text-sm text-gray-400">
              One or both agents failed to respond. Try again with different agents.
            </p>
          </div>
        )}

        {/* Back to arena */}
        <div className="text-center pt-4">
          <a
            href="/arena"
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            &larr; Back to Arena
          </a>
        </div>
      </main>
    </div>
  );
}
