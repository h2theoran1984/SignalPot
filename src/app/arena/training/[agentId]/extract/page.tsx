"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import SiteNav from "@/components/SiteNav";

// ── Types (mirrors ExtractReport from extract-report.ts) ──

interface MatchDetail {
  matchId: string;
  matchType: "undercard" | "championship";
  matchCategory: "training" | "arena" | "job";
  capability: string;
  opponent: { name: string; slug: string };
  side: "a" | "b";
  result: "win" | "loss" | "tie";
  level: number | null;
  promptText: string | null;
  challengeTitle: string | null;
  durationMs: number | null;
  opponentDurationMs: number | null;
  totalScore: number | null;
  opponentTotalScore: number | null;
  criteriaScores: Array<{ name: string; score: number; weight: number; notes?: string }>;
  speedScore: number | null;
  costEfficiency: number | null;
  schemaCompliance: number | null;
  judgmentReasoning: string | null;
  judgmentConfidence: number | null;
  cost: number;
  apiCost: number;
  opponentCost: number;
  opponentApiCost: number;
  completedAt: string | null;
  createdAt: string;
}

interface CriterionSummary {
  name: string;
  weight: number;
  avgScore: number;
  trend: "improving" | "declining" | "stable";
  best: number;
  worst: number;
  matchCount: number;
}

interface ExtractReport {
  agentId: string;
  agentName: string;
  agentSlug: string;
  generatedAt: string;
  overall: {
    totalMatches: number;
    wins: number;
    losses: number;
    ties: number;
    winRate: number;
    avgScore: number;
    eloCurrent: number;
    eloByCapability: Record<string, number>;
  };
  byCategory: {
    training: { matches: number; wins: number; winRate: number };
    arena: { matches: number; wins: number; winRate: number };
    job: { matches: number; wins: number; winRate: number };
  };
  matches: MatchDetail[];
  criteria: CriterionSummary[];
  strengths: string[];
  weaknesses: string[];
  costs: {
    totalApiCost: number;
    totalAgentCost: number;
    avgApiCostPerMatch: number;
    avgApiCostPerWin: number;
    costPerCapability: Record<string, { apiCost: number; matches: number; avg: number }>;
    margin: number;
    marginPercent: number;
  };
  external: {
    totalCalls: number;
    successfulCalls: number;
    successRate: number;
    totalApiCost: number;
    totalRevenue: number;
    avgDurationMs: number | null;
    byCapability: Record<string, { calls: number; successful: number; apiCost: number; avgMs: number | null }>;
    byCaller: Record<string, number>;
  };
  recommendations: {
    pricing: string;
    performance: string;
    readiness: string;
    marketing: string;
  };
  marketplaceReadiness: {
    google_cloud: { ready: boolean; reasons: string[] };
    azure: { ready: boolean; reasons: string[] };
    databricks: { ready: boolean; reasons: string[] };
  };
}

// ── Helpers ──

function scoreColor(score: number): string {
  if (score > 0.7) return "text-emerald-400";
  if (score >= 0.5) return "text-yellow-400";
  return "text-red-400";
}

function resultBadge(result: "win" | "loss" | "tie") {
  const styles = {
    win: "bg-emerald-950/50 text-emerald-400 border-emerald-800/50",
    loss: "bg-red-950/50 text-red-400 border-red-800/50",
    tie: "bg-yellow-950/50 text-yellow-400 border-yellow-800/50",
  };
  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-bold uppercase rounded border ${styles[result]}`}>
      {result}
    </span>
  );
}

function categoryBadge(cat: "training" | "arena" | "job") {
  const styles = {
    training: "bg-blue-950/50 text-blue-400 border-blue-800/50",
    arena: "bg-purple-950/50 text-purple-400 border-purple-800/50",
    job: "bg-amber-950/50 text-amber-400 border-amber-800/50",
  };
  return (
    <span className={`inline-flex px-2 py-0.5 text-[10px] font-medium uppercase rounded border ${styles[cat]}`}>
      {cat}
    </span>
  );
}

function trendArrow(trend: "improving" | "declining" | "stable") {
  switch (trend) {
    case "improving": return <span className="text-emerald-400">&uarr;</span>;
    case "declining": return <span className="text-red-400">&darr;</span>;
    case "stable": return <span className="text-gray-500">&rarr;</span>;
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Skeleton ──

function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`bg-[#111118] border border-[#1f2028] rounded-lg animate-pulse ${className}`}>
      <div className="p-5">
        <div className="h-3 bg-[#1f2028] rounded w-1/3 mb-3" />
        <div className="h-6 bg-[#1f2028] rounded w-1/2" />
      </div>
    </div>
  );
}

// ── Match Detail Card ──

function MatchCard({ match, defaultExpanded }: { match: MatchDetail; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);

  return (
    <div className="bg-[#111118] border border-[#1f2028] rounded-lg overflow-hidden">
      {/* Summary row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[#16161f] transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {resultBadge(match.result)}
          {categoryBadge(match.matchCategory)}
          <span className="text-sm text-gray-300 truncate">
            vs <span className="text-white font-medium">{match.opponent.name}</span>
          </span>
          {match.challengeTitle && (
            <span className="text-xs text-gray-600 truncate hidden md:inline">
              &mdash; {match.challengeTitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {match.totalScore != null && (
            <span className={`text-sm font-bold ${scoreColor(match.totalScore)}`}>
              {(match.totalScore * 100).toFixed(0)}%
            </span>
          )}
          <span className="text-xs text-gray-600">{formatDuration(match.durationMs)}</span>
          <span className="text-xs text-gray-600">{formatCost(match.apiCost)}</span>
          <span className="text-xs text-gray-600">{formatDate(match.completedAt)}</span>
          <svg
            className={`w-4 h-4 text-gray-600 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-[#1f2028]">
          {/* Meta row */}
          <div className="flex flex-wrap gap-4 py-3 text-xs text-gray-500">
            <span>Capability: <span className="text-gray-300">{match.capability}</span></span>
            {match.level != null && <span>Level: <span className="text-gray-300">{match.level}</span></span>}
            <span>Type: <span className="text-gray-300">{match.matchType}</span></span>
            <span>Side: <span className="text-gray-300">{match.side.toUpperCase()}</span></span>
            {match.judgmentConfidence != null && (
              <span>Confidence: <span className="text-gray-300">{(match.judgmentConfidence * 100).toFixed(0)}%</span></span>
            )}
          </div>

          {/* Scores vs opponent */}
          {match.totalScore != null && match.opponentTotalScore != null && (
            <div className="flex gap-4 mb-3">
              <div className="flex-1 p-3 bg-[#0d0d14] rounded-lg">
                <p className="text-[10px] text-gray-600 uppercase mb-1">Your Score</p>
                <p className={`text-lg font-bold ${scoreColor(match.totalScore)}`}>
                  {(match.totalScore * 100).toFixed(1)}%
                </p>
              </div>
              <div className="flex-1 p-3 bg-[#0d0d14] rounded-lg">
                <p className="text-[10px] text-gray-600 uppercase mb-1">Opponent Score</p>
                <p className={`text-lg font-bold ${scoreColor(match.opponentTotalScore)}`}>
                  {(match.opponentTotalScore * 100).toFixed(1)}%
                </p>
              </div>
              <div className="flex-1 p-3 bg-[#0d0d14] rounded-lg">
                <p className="text-[10px] text-gray-600 uppercase mb-1">Speed</p>
                <p className="text-lg font-bold text-gray-300">
                  {formatDuration(match.durationMs)}
                  <span className="text-xs text-gray-600 ml-1">vs {formatDuration(match.opponentDurationMs)}</span>
                </p>
              </div>
            </div>
          )}

          {/* Per-criterion scores */}
          {match.criteriaScores.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-500 font-medium mb-2">Criteria Scores</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                {match.criteriaScores.map((cs) => (
                  <div key={cs.name} className="flex items-center gap-2 py-1 px-2 bg-[#0d0d14] rounded">
                    <span className="text-xs text-gray-400 flex-1 truncate">{cs.name}</span>
                    <span className="text-[10px] text-gray-600">{(cs.weight * 100).toFixed(0)}%</span>
                    <span className={`text-xs font-bold ${scoreColor(cs.score)}`}>
                      {(cs.score * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
              {/* Speed / cost efficiency / schema compliance */}
              <div className="flex gap-2 mt-1">
                {match.speedScore != null && (
                  <div className="flex items-center gap-1 py-1 px-2 bg-[#0d0d14] rounded">
                    <span className="text-xs text-gray-400">Speed</span>
                    <span className={`text-xs font-bold ${scoreColor(match.speedScore)}`}>
                      {(match.speedScore * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
                {match.costEfficiency != null && (
                  <div className="flex items-center gap-1 py-1 px-2 bg-[#0d0d14] rounded">
                    <span className="text-xs text-gray-400">Cost Eff.</span>
                    <span className={`text-xs font-bold ${scoreColor(match.costEfficiency)}`}>
                      {(match.costEfficiency * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
                {match.schemaCompliance != null && (
                  <div className="flex items-center gap-1 py-1 px-2 bg-[#0d0d14] rounded">
                    <span className="text-xs text-gray-400">Schema</span>
                    <span className={`text-xs font-bold ${scoreColor(match.schemaCompliance)}`}>
                      {(match.schemaCompliance * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Cost breakdown */}
          <div className="flex gap-4 mb-3 text-xs">
            <div>
              <span className="text-gray-500">Your API cost: </span>
              <span className="text-gray-300">{formatCost(match.apiCost)}</span>
            </div>
            <div>
              <span className="text-gray-500">Your billing rate: </span>
              <span className="text-gray-300">{formatCost(match.cost)}</span>
            </div>
            <div>
              <span className="text-gray-500">Opponent API cost: </span>
              <span className="text-gray-300">{formatCost(match.opponentApiCost)}</span>
            </div>
          </div>

          {/* Judgment reasoning */}
          {match.judgmentReasoning && (
            <div className="p-3 bg-[#0d0d14] rounded-lg">
              <p className="text-[10px] text-gray-600 uppercase mb-1">Arbiter Reasoning</p>
              <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">
                {match.judgmentReasoning}
              </p>
            </div>
          )}

          {/* Link to full match */}
          <div className="mt-3">
            <a
              href={`/arena/${match.matchId}`}
              className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              View full match &rarr;
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Filter Controls ──

type CategoryFilter = "all" | "training" | "arena" | "job";
type ResultFilter = "all" | "win" | "loss" | "tie";

function FilterButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
        active
          ? "bg-[#1f2028] border-gray-600 text-white"
          : "border-[#1f2028] text-gray-500 hover:text-gray-400 hover:border-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

// ── Page Component ──

export default function ExtractReportPage() {
  const params = useParams();
  const agentId = params.agentId as string;

  const [report, setReport] = useState<ExtractReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");

  useEffect(() => {
    async function fetchReport() {
      try {
        const res = await fetch(`/api/arena/extract?agent_id=${encodeURIComponent(agentId)}`);
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? `Failed to load report (${res.status})`);
        }
        setReport(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    if (agentId) fetchReport();
  }, [agentId]);

  const filteredMatches = report?.matches.filter((m) => {
    if (categoryFilter !== "all" && m.matchCategory !== categoryFilter) return false;
    if (resultFilter !== "all" && m.result !== resultFilter) return false;
    return true;
  }) ?? [];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white bg-dot-grid">
      <SiteNav />

      <main className="max-w-5xl mx-auto px-4 py-12">
        {/* Back link */}
        <a
          href={`/arena/training/${agentId}`}
          className="text-sm text-gray-600 hover:text-gray-400 transition-colors mb-6 inline-block"
        >
          &larr; Back to Training Report
        </a>

        {/* Loading */}
        {loading && (
          <>
            <div className="h-8 bg-[#1f2028] rounded w-72 mb-2 animate-pulse" />
            <div className="h-4 bg-[#1f2028] rounded w-48 mb-8 animate-pulse" />
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              {[1, 2, 3, 4, 5].map((i) => <SkeletonCard key={i} className="h-24" />)}
            </div>
            <SkeletonCard className="h-48 mb-8" />
            <SkeletonCard className="h-64 mb-8" />
            {[1, 2, 3].map((i) => <SkeletonCard key={i} className="h-16 mb-2" />)}
          </>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="p-6 bg-red-950/30 border border-red-900/50 rounded-lg text-center">
            <p className="text-red-400 font-medium mb-2">Failed to load extract report</p>
            <p className="text-sm text-gray-500">{error}</p>
            <a
              href={`/arena/training/${agentId}`}
              className="inline-block mt-4 px-4 py-2 border border-gray-700 text-gray-400 rounded-lg hover:border-gray-600 hover:text-gray-300 transition-colors text-sm"
            >
              Back to Training Report
            </a>
          </div>
        )}

        {/* Report */}
        {!loading && report && (
          <>
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-bold mb-1">
                Extract Report: <span className="text-cyan-400">{report.agentName}</span>
              </h1>
              <p className="text-sm text-gray-500">
                Generated {new Date(report.generatedAt).toLocaleString()} &middot; {report.overall.totalMatches} matches analyzed
              </p>
            </div>

            {/* ═══ Overall Stats ═══ */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Win Rate</p>
                <p className={`text-2xl font-bold ${report.overall.winRate >= 0.5 ? "text-emerald-400" : "text-red-400"}`}>
                  {Math.round(report.overall.winRate * 100)}%
                </p>
                <p className="text-[10px] text-gray-600">
                  {report.overall.wins}W / {report.overall.losses}L / {report.overall.ties}T
                </p>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Avg Score</p>
                <p className={`text-2xl font-bold ${scoreColor(report.overall.avgScore)}`}>
                  {(report.overall.avgScore * 100).toFixed(0)}%
                </p>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">ELO</p>
                <p className="text-2xl font-bold text-cyan-400">{report.overall.eloCurrent}</p>
                {Object.entries(report.overall.eloByCapability).length > 1 && (
                  <div className="text-[10px] text-gray-600 mt-1">
                    {Object.entries(report.overall.eloByCapability).map(([cap, elo]) => (
                      <span key={cap} className="mr-2">{cap}: {elo}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Total API Cost</p>
                <p className="text-2xl font-bold text-white">{formatCost(report.costs.totalApiCost)}</p>
                <p className="text-[10px] text-gray-600">
                  {formatCost(report.costs.avgApiCostPerMatch)}/match
                </p>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Margin</p>
                <p className={`text-2xl font-bold ${report.costs.marginPercent >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {report.costs.marginPercent.toFixed(0)}%
                </p>
                <p className="text-[10px] text-gray-600">
                  {formatCost(report.costs.margin)} total
                </p>
              </div>
            </div>

            {/* ═══ Category Breakdown ═══ */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              {(["training", "arena", "job"] as const).map((cat) => {
                const data = report.byCategory[cat];
                if (data.matches === 0) return (
                  <div key={cat} className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg opacity-50">
                    <p className="text-xs text-gray-500 mb-1 uppercase">{cat}</p>
                    <p className="text-sm text-gray-600">No matches</p>
                  </div>
                );
                return (
                  <div key={cat} className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                    <p className="text-xs text-gray-500 mb-1 uppercase">{cat}</p>
                    <p className={`text-xl font-bold ${data.winRate >= 0.5 ? "text-emerald-400" : "text-red-400"}`}>
                      {Math.round(data.winRate * 100)}% WR
                    </p>
                    <p className="text-[10px] text-gray-600">
                      {data.wins}W / {data.matches - data.wins}L &middot; {data.matches} matches
                    </p>
                  </div>
                );
              })}
            </div>

            {/* ═══ Criteria Summary ═══ */}
            {report.criteria.length > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-semibold mb-4">Criteria Summary</h2>
                <div className="bg-[#111118] border border-[#1f2028] rounded-lg overflow-hidden">
                  <div className="grid grid-cols-12 gap-2 px-4 py-3 text-xs text-gray-500 font-medium border-b border-[#1f2028] bg-[#0d0d14]">
                    <div className="col-span-3">Criterion</div>
                    <div className="col-span-1 text-center">Wt</div>
                    <div className="col-span-2 text-center">Avg</div>
                    <div className="col-span-1 text-center">Trend</div>
                    <div className="col-span-1 text-center">Best</div>
                    <div className="col-span-1 text-center">Worst</div>
                    <div className="col-span-3 text-center">Matches</div>
                  </div>
                  {report.criteria.map((c) => (
                    <div key={c.name} className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-[#1f2028] last:border-b-0 items-center">
                      <div className="col-span-3 text-sm font-medium text-gray-300 truncate">{c.name}</div>
                      <div className="col-span-1 text-center text-xs text-gray-600">{(c.weight * 100).toFixed(0)}%</div>
                      <div className={`col-span-2 text-center text-sm font-bold ${scoreColor(c.avgScore)}`}>
                        {(c.avgScore * 100).toFixed(0)}%
                      </div>
                      <div className="col-span-1 text-center text-sm">{trendArrow(c.trend)}</div>
                      <div className="col-span-1 text-center text-xs text-emerald-400 font-mono">{(c.best * 100).toFixed(0)}%</div>
                      <div className="col-span-1 text-center text-xs text-red-400 font-mono">{(c.worst * 100).toFixed(0)}%</div>
                      <div className="col-span-3 text-center text-xs text-gray-600">{c.matchCount} scored</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ═══ Strengths & Weaknesses ═══ */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <div className="p-5 bg-[#111118] border border-emerald-900/30 rounded-lg">
                <h3 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-3">Strengths</h3>
                {report.strengths.length === 0 ? (
                  <p className="text-sm text-gray-500">No clear strengths identified yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {report.strengths.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                        <span className="text-emerald-400 shrink-0 mt-0.5">+</span> {s}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="p-5 bg-[#111118] border border-red-900/30 rounded-lg">
                <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-3">Weaknesses</h3>
                {report.weaknesses.length === 0 ? (
                  <p className="text-sm text-gray-500">No clear weaknesses identified yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {report.weaknesses.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                        <span className="text-red-400 shrink-0 mt-0.5">!</span> {w}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* ═══ Cost Analysis ═══ */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-4">Cost Analysis</h2>
              <div className="bg-[#111118] border border-[#1f2028] rounded-lg p-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Total API Cost</p>
                    <p className="text-lg font-bold text-white">{formatCost(report.costs.totalApiCost)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Total Billed</p>
                    <p className="text-lg font-bold text-white">{formatCost(report.costs.totalAgentCost)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Avg Cost / Win</p>
                    <p className="text-lg font-bold text-white">{formatCost(report.costs.avgApiCostPerWin)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Margin</p>
                    <p className={`text-lg font-bold ${report.costs.marginPercent >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {formatCost(report.costs.margin)} ({report.costs.marginPercent.toFixed(0)}%)
                    </p>
                  </div>
                </div>

                {/* Cost per capability */}
                {Object.keys(report.costs.costPerCapability).length > 0 && (
                  <>
                    <p className="text-xs text-gray-500 font-medium mb-2">Cost by Capability</p>
                    <div className="space-y-1">
                      {Object.entries(report.costs.costPerCapability).map(([cap, data]) => (
                        <div key={cap} className="flex items-center gap-3 py-1 px-2 bg-[#0d0d14] rounded text-xs">
                          <span className="text-gray-300 font-medium w-40 truncate">{cap}</span>
                          <span className="text-gray-500">{data.matches} matches</span>
                          <span className="text-gray-400">total: {formatCost(data.apiCost)}</span>
                          <span className="text-gray-400">avg: {formatCost(data.avg)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* ═══ External Usage ═══ */}
            {report.external.totalCalls > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-semibold mb-4">
                  External Usage
                  <span className="text-sm text-gray-500 font-normal ml-2">via telemetry beacon</span>
                </h2>
                <div className="bg-[#111118] border border-[#1f2028] rounded-lg p-5">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Total Calls</p>
                      <p className="text-lg font-bold text-white">{report.external.totalCalls}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Success Rate</p>
                      <p className={`text-lg font-bold ${report.external.successRate >= 0.95 ? "text-emerald-400" : report.external.successRate >= 0.8 ? "text-yellow-400" : "text-red-400"}`}>
                        {(report.external.successRate * 100).toFixed(0)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">API Cost</p>
                      <p className="text-lg font-bold text-white">{formatCost(report.external.totalApiCost)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Revenue</p>
                      <p className="text-lg font-bold text-cyan-400">{formatCost(report.external.totalRevenue)}</p>
                    </div>
                    {report.external.avgDurationMs != null && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Avg Latency</p>
                        <p className="text-lg font-bold text-white">{formatDuration(report.external.avgDurationMs)}</p>
                      </div>
                    )}
                  </div>

                  {/* By capability */}
                  {Object.keys(report.external.byCapability).length > 0 && (
                    <>
                      <p className="text-xs text-gray-500 font-medium mb-2">By Capability</p>
                      <div className="space-y-1 mb-3">
                        {Object.entries(report.external.byCapability).map(([cap, d]) => (
                          <div key={cap} className="flex items-center gap-3 py-1 px-2 bg-[#0d0d14] rounded text-xs">
                            <span className="text-gray-300 font-medium w-40 truncate">{cap}</span>
                            <span className="text-gray-500">{d.calls} calls</span>
                            <span className={`${d.successful / d.calls >= 0.95 ? "text-emerald-400" : "text-yellow-400"}`}>
                              {((d.successful / d.calls) * 100).toFixed(0)}% success
                            </span>
                            <span className="text-gray-400">{formatCost(d.apiCost)}</span>
                            {d.avgMs != null && <span className="text-gray-500">{formatDuration(d.avgMs)}</span>}
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* By caller */}
                  {Object.keys(report.external.byCaller).length > 1 && (
                    <>
                      <p className="text-xs text-gray-500 font-medium mb-2">By Caller</p>
                      <div className="flex gap-2 flex-wrap">
                        {Object.entries(report.external.byCaller).map(([caller, count]) => (
                          <span key={caller} className="px-2 py-1 bg-[#0d0d14] rounded text-xs text-gray-400">
                            {caller}: <span className="text-white">{count}</span>
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </section>
            )}

            {/* ═══ Recommendations ═══ */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-4">Recommendations</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {([
                  { key: "pricing" as const, label: "Pricing", color: "border-cyan-400", icon: "$" },
                  { key: "performance" as const, label: "Performance", color: "border-purple-400", icon: "^" },
                  { key: "readiness" as const, label: "Arena Readiness", color: "border-emerald-400", icon: "!" },
                  { key: "marketing" as const, label: "Marketing", color: "border-amber-400", icon: "*" },
                ]).map(({ key, label, color, icon }) => (
                  <div key={key} className={`p-5 bg-[#111118] border-l-4 ${color} rounded-r-lg`}>
                    <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">
                      {icon} {label}
                    </p>
                    <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {report.recommendations[key]}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* ═══ Marketplace Readiness ═══ */}
            {report.marketplaceReadiness && (
              <section className="mb-8">
                <h2 className="text-lg font-semibold mb-4">Marketplace Readiness</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {([
                    { key: "google_cloud" as const, label: "Google Cloud", icon: "GCP" },
                    { key: "azure" as const, label: "Azure", icon: "AZ" },
                    { key: "databricks" as const, label: "Databricks", icon: "DB" },
                  ]).map(({ key, label, icon }) => {
                    const mp = report.marketplaceReadiness[key];
                    return (
                      <div
                        key={key}
                        className={`p-5 bg-[#111118] border rounded-lg ${
                          mp.ready
                            ? "border-emerald-800/50"
                            : "border-[#1f2028]"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-500 bg-[#0d0d14] px-2 py-1 rounded">{icon}</span>
                            <span className="text-sm font-semibold text-gray-200">{label}</span>
                          </div>
                          <span
                            className={`inline-flex px-2 py-0.5 text-xs font-bold uppercase rounded border ${
                              mp.ready
                                ? "bg-emerald-950/50 text-emerald-400 border-emerald-800/50"
                                : "bg-red-950/50 text-red-400 border-red-800/50"
                            }`}
                          >
                            {mp.ready ? "Ready" : "Not Ready"}
                          </span>
                        </div>
                        {mp.reasons.length > 0 && (
                          <ul className="space-y-1">
                            {mp.reasons.map((reason, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                                <span className="text-red-400 shrink-0 mt-0.5">!</span>
                                {reason}
                              </li>
                            ))}
                          </ul>
                        )}
                        {mp.ready && mp.reasons.length === 0 && (
                          <p className="text-xs text-emerald-400/70">All requirements met.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ═══ Match-by-Match Detail ═══ */}
            <section className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">
                  Match Detail
                  <span className="text-sm text-gray-500 font-normal ml-2">
                    ({filteredMatches.length} of {report.matches.length})
                  </span>
                </h2>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap gap-2 mb-4">
                <div className="flex gap-1">
                  {(["all", "training", "arena", "job"] as const).map((cat) => (
                    <FilterButton
                      key={cat}
                      active={categoryFilter === cat}
                      onClick={() => setCategoryFilter(cat)}
                    >
                      {cat === "all" ? "All Types" : cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </FilterButton>
                  ))}
                </div>
                <div className="w-px bg-[#1f2028] mx-1" />
                <div className="flex gap-1">
                  {(["all", "win", "loss", "tie"] as const).map((res) => (
                    <FilterButton
                      key={res}
                      active={resultFilter === res}
                      onClick={() => setResultFilter(res)}
                    >
                      {res === "all" ? "All Results" : res.charAt(0).toUpperCase() + res.slice(1) + "s"}
                    </FilterButton>
                  ))}
                </div>
              </div>

              {/* Match list (newest first) */}
              <div className="space-y-2">
                {[...filteredMatches].reverse().map((match) => (
                  <MatchCard key={match.matchId} match={match} />
                ))}
                {filteredMatches.length === 0 && (
                  <div className="p-8 text-center text-gray-600 text-sm">
                    No matches found with the current filters.
                  </div>
                )}
              </div>
            </section>

            {/* ═══ Actions ═══ */}
            <div className="flex items-center gap-3 pt-4 border-t border-[#1f2028]">
              <a
                href={`/arena/training/${agentId}`}
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-[#1f2028] text-gray-400 font-medium rounded-lg hover:border-[#2d3044] hover:text-gray-300 transition-colors"
              >
                Back to Training Report
              </a>
              <a
                href="/arena?tab=training"
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-[#1f2028] text-gray-400 font-medium rounded-lg hover:border-[#2d3044] hover:text-gray-300 transition-colors"
              >
                Training Hub
              </a>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
