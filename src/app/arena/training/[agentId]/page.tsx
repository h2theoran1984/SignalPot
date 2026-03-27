"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import SiteNav from "@/components/SiteNav";

// ── Training Report Types ──

interface CriterionBreakdown {
  name: string;
  weight: number;
  avgScore: number;
  trend: "up" | "down" | "stable";
  bestScore: number;
  worstScore: number;
  matchScores: number[];
}

interface TrainingReport {
  agentId: string;
  agentName: string;
  agentSlug: string;
  period: { from: string; to: string };
  matchCount: number;
  winRate: number;
  eloStart: number;
  eloCurrent: number;
  eloChange: number;
  criteria: CriterionBreakdown[];
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
}

// ── Helpers ──

function scoreColor(score: number): string {
  if (score > 7) return "text-emerald-400";
  if (score >= 5) return "text-yellow-400";
  return "text-red-400";
}

function scoreBgColor(score: number): string {
  if (score > 7) return "bg-emerald-400";
  if (score >= 5) return "bg-yellow-400";
  return "bg-red-400";
}

function trendArrow(trend: "up" | "down" | "stable"): { icon: string; color: string } {
  switch (trend) {
    case "up":
      return { icon: "\u2191", color: "text-emerald-400" };
    case "down":
      return { icon: "\u2193", color: "text-red-400" };
    case "stable":
      return { icon: "\u2192", color: "text-gray-500" };
  }
}

// ── Skeleton Components ──

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

// ── Page Component ──

export default function TrainingReportPage() {
  const params = useParams();
  const agentId = params.agentId as string;

  const [report, setReport] = useState<TrainingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchReport() {
      try {
        const res = await fetch(
          `/api/arena/training/report?agent_id=${encodeURIComponent(agentId)}`
        );
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? `Failed to load report (${res.status})`);
        }
        const data: TrainingReport = await res.json();
        setReport(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    if (agentId) fetchReport();
  }, [agentId]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white bg-dot-grid">
      <SiteNav />

      <main className="max-w-4xl mx-auto px-4 py-12">
        {/* Back link */}
        <a
          href="/arena?tab=training"
          className="text-sm text-gray-600 hover:text-gray-400 transition-colors mb-6 inline-block"
        >
          &larr; Back to Training
        </a>

        {/* Loading State */}
        {loading && (
          <>
            <div className="h-8 bg-[#1f2028] rounded w-64 mb-2 animate-pulse" />
            <div className="h-4 bg-[#1f2028] rounded w-48 mb-8 animate-pulse" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[1, 2, 3, 4].map((i) => (
                <SkeletonCard key={i} className="h-24" />
              ))}
            </div>
            <SkeletonCard className="h-64 mb-8" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <SkeletonCard className="h-32" />
              <SkeletonCard className="h-32" />
            </div>
            <SkeletonCard className="h-40" />
          </>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="p-6 bg-red-950/30 border border-red-900/50 rounded-lg text-center">
            <p className="text-red-400 font-medium mb-2">Failed to load report</p>
            <p className="text-sm text-gray-500">{error}</p>
            <a
              href="/arena?tab=training"
              className="inline-block mt-4 px-4 py-2 border border-gray-700 text-gray-400 rounded-lg hover:border-gray-600 hover:text-gray-300 transition-colors text-sm"
            >
              Back to Training
            </a>
          </div>
        )}

        {/* Report Content */}
        {!loading && report && (
          <>
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-bold mb-1">
                Training Report: <span className="text-cyan-400">{report.agentName}</span>
              </h1>
              <p className="text-sm text-gray-500">
                {new Date(report.period.from).toLocaleDateString()} &mdash;{" "}
                {new Date(report.period.to).toLocaleDateString()}
              </p>
            </div>

            {/* ── Overall Stats ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Win Rate</p>
                <p className={`text-2xl font-bold ${report.winRate >= 50 ? "text-emerald-400" : "text-red-400"}`}>
                  {report.winRate}%
                </p>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">ELO Change</p>
                <p className={`text-2xl font-bold ${report.eloChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {report.eloChange > 0 ? "+" : ""}
                  {report.eloChange}
                </p>
                <p className="text-[10px] text-gray-600">
                  {report.eloStart} &rarr; {report.eloCurrent}
                </p>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Matches</p>
                <p className="text-2xl font-bold text-white">{report.matchCount}</p>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Current ELO</p>
                <p className="text-2xl font-bold text-cyan-400">{report.eloCurrent}</p>
              </div>
            </div>

            {/* ── Criteria Breakdown ── */}
            {report.criteria.length > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-semibold mb-4">Criteria Breakdown</h2>
                <div className="bg-[#111118] border border-[#1f2028] rounded-lg overflow-hidden">
                  {/* Table header */}
                  <div className="grid grid-cols-12 gap-2 px-4 py-3 text-xs text-gray-500 font-medium border-b border-[#1f2028] bg-[#0d0d14]">
                    <div className="col-span-3">Criterion</div>
                    <div className="col-span-1 text-center">Wt</div>
                    <div className="col-span-1 text-center">Avg</div>
                    <div className="col-span-1 text-center">Trend</div>
                    <div className="col-span-1 text-center">Best</div>
                    <div className="col-span-1 text-center">Worst</div>
                    <div className="col-span-4">History</div>
                  </div>

                  {/* Rows */}
                  {report.criteria.map((c) => {
                    const trend = trendArrow(c.trend);
                    return (
                      <div
                        key={c.name}
                        className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-[#1f2028] last:border-b-0 items-center"
                      >
                        <div className="col-span-3 text-sm font-medium text-gray-300 truncate">
                          {c.name}
                        </div>
                        <div className="col-span-1 text-center text-xs text-gray-600">
                          {c.weight}
                        </div>
                        <div className={`col-span-1 text-center text-sm font-bold ${scoreColor(c.avgScore)}`}>
                          {c.avgScore.toFixed(1)}
                        </div>
                        <div className={`col-span-1 text-center text-sm font-bold ${trend.color}`}>
                          {trend.icon}
                        </div>
                        <div className="col-span-1 text-center text-xs text-emerald-400 font-mono">
                          {c.bestScore.toFixed(1)}
                        </div>
                        <div className="col-span-1 text-center text-xs text-red-400 font-mono">
                          {c.worstScore.toFixed(1)}
                        </div>
                        {/* Mini sparkline: colored dots */}
                        <div className="col-span-4 flex items-center gap-0.5">
                          {c.matchScores.map((score, idx) => (
                            <div
                              key={idx}
                              className={`w-2 h-2 rounded-full ${scoreBgColor(score)}`}
                              title={`Match ${idx + 1}: ${score.toFixed(1)}`}
                              style={{ opacity: 0.4 + (idx / c.matchScores.length) * 0.6 }}
                            />
                          ))}
                          {c.matchScores.length === 0 && (
                            <span className="text-[10px] text-gray-600">No data</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Strengths & Weaknesses ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              {/* Strengths */}
              <div className="p-5 bg-[#111118] border border-emerald-900/30 rounded-lg">
                <h3 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-3">
                  Strengths
                </h3>
                {report.strengths.length === 0 ? (
                  <p className="text-sm text-gray-500">No clear strengths identified yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {report.strengths.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                        <span className="text-emerald-400 shrink-0 mt-0.5">+</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Weaknesses */}
              <div className="p-5 bg-[#111118] border border-red-900/30 rounded-lg">
                <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-3">
                  Weaknesses
                </h3>
                {report.weaknesses.length === 0 ? (
                  <p className="text-sm text-gray-500">No clear weaknesses identified yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {report.weaknesses.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                        <span className="text-red-400 shrink-0 mt-0.5">!</span>
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* ── Coaching Recommendation ── */}
            {report.recommendation && (
              <section className="mb-8">
                <h2 className="text-lg font-semibold mb-4">Coaching Advice</h2>
                <div className="p-6 bg-[#111118] border-l-4 border-cyan-400 rounded-r-lg">
                  <div className="flex items-start gap-3">
                    <svg
                      className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                      />
                    </svg>
                    <div>
                      <p className="text-xs text-cyan-400 font-semibold uppercase tracking-wider mb-2">
                        The Arbiter recommends
                      </p>
                      <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                        {report.recommendation}
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* ── Actions ── */}
            <div className="flex items-center gap-3 pt-4 border-t border-[#1f2028]">
              <a
                href={`/arena/new?agent_a=${report.agentSlug}&agent_b=sparring-partner`}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Continue Training
              </a>
              <a
                href="/arena?tab=training"
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-[#1f2028] text-gray-400 font-medium rounded-lg hover:border-[#2d3044] hover:text-gray-300 transition-colors"
              >
                Back to Training
              </a>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
