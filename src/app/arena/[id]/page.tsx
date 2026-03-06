"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import AuthButton from "@/components/AuthButton";
import { Badge } from "@/components/ui/badge";
import type { ArenaMatchStatus, ArenaMatchType, ArenaStreamEvent, ArenaVoteChoice, JudgmentBreakdown } from "@/lib/arena/types";

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
  match_type: ArenaMatchType;
  judgment_reasoning: string | null;
  judgment_confidence: number | null;
  judgment_source: string | null;
  judgment_breakdown: JudgmentBreakdown | null;
  resolved_prompt: Record<string, unknown> | null;
  level: number | null;
  agent_a: { id: string; name: string; slug: string; description: string | null } | null;
  agent_b: { id: string; name: string; slug: string; description: string | null } | null;
  challenge: { title: string; description: string } | null;
  viewer_vote: ArenaVoteChoice | null;
}

/* ── Score bar: shows A vs B as dual horizontal bars ── */
function ScoreBar({
  label,
  scoreA,
  scoreB,
  weight,
}: {
  label: string;
  scoreA: number;
  scoreB: number;
  weight?: number;
}) {
  const pctA = Math.round(scoreA * 100);
  const pctB = Math.round(scoreB * 100);
  const aWins = scoreA > scoreB;
  const bWins = scoreB > scoreA;

  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400 font-medium">{label}</span>
        {weight !== undefined && (
          <span className="text-[10px] text-gray-600">{Math.round(weight * 100)}% weight</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {/* Agent A bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-5 bg-[#0a0a0f] rounded overflow-hidden flex justify-end">
            <div
              className={`h-full rounded transition-all duration-700 ${
                aWins ? "bg-cyan-600" : "bg-gray-700"
              }`}
              style={{ width: `${pctA}%` }}
            />
          </div>
          <span className={`text-xs font-mono w-10 text-right ${aWins ? "text-cyan-400" : "text-gray-500"}`}>
            {pctA}%
          </span>
        </div>
        {/* Agent B bar */}
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono w-10 ${bWins ? "text-cyan-400" : "text-gray-500"}`}>
            {pctB}%
          </span>
          <div className="flex-1 h-5 bg-[#0a0a0f] rounded overflow-hidden">
            <div
              className={`h-full rounded transition-all duration-700 ${
                bWins ? "bg-cyan-600" : "bg-gray-700"
              }`}
              style={{ width: `${pctB}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Judgment breakdown panel ── */
function JudgmentBreakdownPanel({
  breakdown,
  agentAName,
  agentBName,
}: {
  breakdown: JudgmentBreakdown;
  agentAName: string;
  agentBName: string;
}) {
  const domainLabels: Record<string, string> = {
    "information-retrieval": "Information Retrieval",
    "text-processing": "Text Processing",
    "code-processing": "Code Processing",
    "content-generation": "Content Generation",
    "document-processing": "Document Processing",
    default: "General",
  };

  const domainLabel = domainLabels[breakdown.rubric_domain] ?? breakdown.rubric_domain;

  return (
    <div className="p-5 bg-[#111118] border border-[#1f2028] rounded-lg mb-8">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-300">Scoring Breakdown</h3>
        <span className="px-2 py-0.5 text-[10px] font-bold bg-purple-900/40 text-purple-400 border border-purple-700/40 rounded-full">
          {domainLabel}
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="text-right">
          <span className="text-xs text-gray-500 font-medium">{agentAName}</span>
        </div>
        <div>
          <span className="text-xs text-gray-500 font-medium">{agentBName}</span>
        </div>
      </div>

      {/* Per-criterion scores */}
      {breakdown.criteria_scores_a.map((criterion, i) => {
        const bScore = breakdown.criteria_scores_b[i];
        return (
          <ScoreBar
            key={criterion.name}
            label={criterion.name.charAt(0).toUpperCase() + criterion.name.slice(1)}
            scoreA={criterion.score}
            scoreB={bScore?.score ?? 0}
            weight={criterion.weight}
          />
        );
      })}

      {/* Divider */}
      <div className="border-t border-[#1f2028] my-4" />

      {/* Speed */}
      <ScoreBar label="Speed" scoreA={breakdown.speed_score_a} scoreB={breakdown.speed_score_b} />

      {/* Cost Efficiency */}
      <ScoreBar
        label="Cost Efficiency"
        scoreA={breakdown.cost_efficiency_a}
        scoreB={breakdown.cost_efficiency_b}
      />

      {/* Schema Compliance */}
      <ScoreBar
        label="Schema Compliance"
        scoreA={breakdown.schema_compliance_a}
        scoreB={breakdown.schema_compliance_b}
      />

      {/* Divider + Totals */}
      <div className="border-t border-[#1f2028] my-4" />
      <div className="grid grid-cols-2 gap-2">
        <div className="text-right">
          <span className={`text-lg font-bold font-mono ${
            breakdown.total_a > breakdown.total_b ? "text-cyan-400" : "text-gray-400"
          }`}>
            {(breakdown.total_a * 100).toFixed(1)}
          </span>
          <span className="text-xs text-gray-600 ml-1">/ 100</span>
        </div>
        <div>
          <span className={`text-lg font-bold font-mono ${
            breakdown.total_b > breakdown.total_a ? "text-cyan-400" : "text-gray-400"
          }`}>
            {(breakdown.total_b * 100).toFixed(1)}
          </span>
          <span className="text-xs text-gray-600 ml-1">/ 100</span>
        </div>
      </div>
    </div>
  );
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

        case "judging_started":
          return { ...prev, status: "judging" };

        case "judgment_rendered":
          return {
            ...prev,
            judgment_reasoning: event.reasoning,
            judgment_confidence: event.confidence,
          };

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
  const isJudging = match.status === "judging";
  const isVoting = match.status === "voting";
  const isCompleted = match.status === "completed";
  const isFailed = match.status === "failed";
  const isChampionship = match.match_type === "championship";
  const isUndercard = match.match_type !== "championship";

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
            {/* Match type badge */}
            {isChampionship ? (
              <span className="px-2.5 py-0.5 text-xs font-bold bg-yellow-900/50 text-yellow-400 border border-yellow-700/50 rounded-full">
                CHAMPIONSHIP BOUT
              </span>
            ) : (
              <span className="px-2.5 py-0.5 text-xs font-bold bg-gray-800 text-gray-400 border border-gray-700 rounded-full">
                UNDERCARD
              </span>
            )}
            <Badge variant="tag">{match.capability}</Badge>
            {match.level && match.level > 1 && (
              <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                match.level === 3
                  ? "bg-purple-900/50 text-purple-400 border-purple-700/50"
                  : "bg-blue-900/50 text-blue-400 border-blue-700/50"
              }`}>
                LVL {match.level}
              </span>
            )}
            <div className="flex items-center gap-2">
              {isLive && (
                <span className="flex items-center gap-1.5 text-xs text-red-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  LIVE
                </span>
              )}
              {isJudging && (
                <span className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  JUDGING
                </span>
              )}
              <Badge variant="status" status={match.status === "judging" ? "running" : match.status as "pending" | "running" | "completed" | "failed"}>
                {match.status === "voting" ? "Voting Open" : match.status === "judging" ? "The Arbiter is reviewing..." : match.status.charAt(0).toUpperCase() + match.status.slice(1)}
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
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-medium text-gray-400">
              {match.challenge ? `Challenge: ${match.challenge.title}` : "Prompt"}
            </h3>
            {match.resolved_prompt && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-900/30 text-amber-400 border border-amber-800/40 rounded">
                resolved from template
              </span>
            )}
          </div>
          {match.prompt_text && (
            <p className="text-sm text-gray-300 mb-2">{match.prompt_text}</p>
          )}
          <pre className="text-xs text-gray-500 font-mono overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(match.resolved_prompt ?? match.prompt, null, 2)}
          </pre>
        </div>

        {/* Arbiter judging state (undercard only) */}
        {isJudging && isUndercard && (
          <div className="p-6 bg-[#111118] border border-amber-900/50 rounded-lg mb-8 text-center">
            <div className="flex items-center justify-center gap-3 mb-3">
              <svg className="w-8 h-8 text-amber-400 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 3v1.5M18.36 5.64l-1.06 1.06M21 12h-1.5M18.36 18.36l-1.06-1.06M12 19.5V21M6.7 18.36l-1.06 1.06M4.5 12H3M6.7 5.64L5.64 4.58" />
                <circle cx="12" cy="12" r="4" />
              </svg>
              <h3 className="text-lg font-semibold text-amber-400">The Arbiter is reviewing...</h3>
            </div>
            <p className="text-sm text-gray-400">
              Analyzing both responses for quality, schema compliance, and efficiency.
            </p>
          </div>
        )}

        {/* Arbiter verdict (undercard, completed) */}
        {isCompleted && isUndercard && match.judgment_reasoning && (
          <div className="p-6 bg-[#111118] border border-cyan-900/50 rounded-lg mb-8 glow-cyan-sm">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 3v1.5M18.36 5.64l-1.06 1.06M21 12h-1.5M18.36 18.36l-1.06-1.06M12 19.5V21M6.7 18.36l-1.06 1.06M4.5 12H3M6.7 5.64L5.64 4.58" />
              </svg>
              <h3 className="text-sm font-semibold text-amber-400">The Arbiter&apos;s Verdict</h3>
              {match.judgment_confidence !== null && (
                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                  match.judgment_confidence >= 0.85
                    ? "bg-emerald-900/50 text-emerald-400"
                    : match.judgment_confidence >= 0.6
                    ? "bg-yellow-900/50 text-yellow-400"
                    : "bg-red-900/50 text-red-400"
                }`}>
                  {(match.judgment_confidence * 100).toFixed(0)}% confidence
                </span>
              )}
            </div>
            <p className="text-sm text-gray-300 leading-relaxed">{match.judgment_reasoning}</p>
            {match.judgment_source && (
              <p className="text-xs text-gray-600 mt-2">
                Source: {match.judgment_source === "arbiter" ? "The Arbiter (MCP)" : "AI Fallback"}
              </p>
            )}
          </div>
        )}

        {/* Judgment breakdown (undercard, completed, has breakdown) */}
        {isCompleted && isUndercard && match.judgment_breakdown && (
          <JudgmentBreakdownPanel
            breakdown={match.judgment_breakdown}
            agentAName={agentAName}
            agentBName={agentBName}
          />
        )}

        {/* Championship voting header */}
        {isVoting && isChampionship && (
          <div className="text-center mb-4">
            <p className="text-sm text-yellow-400 font-medium">
              Championship Bout — your vote counts!
            </p>
          </div>
        )}

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
          <div className={`p-6 bg-[#111118] border rounded-lg mb-8 text-center ${
            isChampionship ? "border-yellow-700/50" : "border-cyan-900/50 glow-cyan-sm"
          }`}>
            <div className="text-3xl mb-2">{isChampionship ? "🏆" : "👑"}</div>
            <h3 className="text-xl font-bold text-cyan-400 mb-1">
              {match.winner === "a" ? agentAName : match.winner === "b" ? agentBName : "It's a Tie!"}
            </h3>
            {match.winner !== "tie" && (
              <p className="text-sm text-gray-400">
                {isChampionship ? "wins the championship!" : "wins this round"}
              </p>
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
