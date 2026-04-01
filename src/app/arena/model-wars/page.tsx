"use client";

import { useEffect, useState } from "react";
import SiteNav from "@/components/SiteNav";

interface ModelData {
  model_id: string;
  label: string;
  provider: string;
  agents: string[];
  matches: number;
  wins: number;
  losses: number;
  ties: number;
  win_rate: number;
  avg_score: number;
  avg_api_cost: number;
  avg_latency_ms: number;
  cost_per_win: number | null;
  pricing_per_m_tokens: { input: number; output: number } | null;
}

interface H2HRecord {
  model_a: string;
  model_b: string;
  label_a: string;
  label_b: string;
  wins_a: number;
  wins_b: number;
  ties: number;
  total: number;
}

interface ModelWarsData {
  models: ModelData[];
  headToHead: H2HRecord[];
  totalMatches: number;
  lastUpdated: string;
}

const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: "text-orange-400",
  Google: "text-blue-400",
  Unknown: "text-gray-400",
};

const PROVIDER_BG: Record<string, string> = {
  Anthropic: "bg-orange-950/30 border-orange-800/40",
  Google: "bg-blue-950/30 border-blue-800/40",
  Unknown: "bg-gray-900/30 border-gray-800/40",
};

const RANK_STYLES = [
  "text-yellow-400 text-5xl", // 1st
  "text-gray-300 text-4xl",   // 2nd
  "text-amber-600 text-3xl",  // 3rd
];

function WinRateBar({ rate, color }: { rate: number; color: string }) {
  return (
    <div className="w-full h-2 bg-[#1f2028] rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-1000 ${color}`}
        style={{ width: `${Math.min(100, rate * 100)}%` }}
      />
    </div>
  );
}

function CostComparison({ models }: { models: ModelData[] }) {
  if (models.length < 2) return null;

  const cheapest = models.reduce((min, m) =>
    m.avg_api_cost > 0 && (min.avg_api_cost === 0 || m.avg_api_cost < min.avg_api_cost) ? m : min
  );
  const mostExpensive = models.reduce((max, m) =>
    m.avg_api_cost > max.avg_api_cost ? m : max
  );

  if (cheapest.avg_api_cost === 0 || mostExpensive.avg_api_cost === 0) return null;
  const multiplier = Math.round(mostExpensive.avg_api_cost / cheapest.avg_api_cost);
  if (multiplier <= 1) return null;

  return (
    <div className="p-6 bg-gradient-to-r from-cyan-950/20 via-[#111118] to-orange-950/20 border border-[#1f2028] rounded-xl mb-8">
      <div className="text-center">
        <p className="text-3xl font-bold text-white mb-2">
          <span className="text-cyan-400">{cheapest.label}</span>
          {" costs "}
          <span className="text-orange-400">{multiplier}x less</span>
          {" than "}
          <span className="text-cyan-400">{mostExpensive.label}</span>
        </p>
        <p className="text-gray-400">
          ${cheapest.avg_api_cost.toFixed(4)}/call vs ${mostExpensive.avg_api_cost.toFixed(4)}/call
          {cheapest.win_rate > mostExpensive.win_rate && (
            <span className="text-emerald-400 ml-2">
              — and wins more often ({Math.round(cheapest.win_rate * 100)}% vs {Math.round(mostExpensive.win_rate * 100)}%)
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

function HeadToHead({ records }: { records: H2HRecord[] }) {
  if (records.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-2xl font-bold mb-4">Head-to-Head</h2>
      <div className="grid gap-3">
        {records
          .filter((r) => r.total >= 2)
          .sort((a, b) => b.total - a.total)
          .map((r) => {
            const totalDecisive = r.wins_a + r.wins_b;
            const pctA = totalDecisive > 0 ? (r.wins_a / totalDecisive) * 100 : 50;
            const pctB = 100 - pctA;
            const aLeads = r.wins_a > r.wins_b;
            const bLeads = r.wins_b > r.wins_a;

            return (
              <div key={`${r.model_a}::${r.model_b}`} className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <span className={`font-semibold ${aLeads ? "text-white" : "text-gray-400"}`}>
                    {r.label_a}
                    <span className="ml-2 font-mono text-sm">{r.wins_a}W</span>
                  </span>
                  <span className="text-xs text-gray-600 font-mono">
                    {r.total} matches{r.ties > 0 ? ` (${r.ties} ties)` : ""}
                  </span>
                  <span className={`font-semibold ${bLeads ? "text-white" : "text-gray-400"}`}>
                    <span className="mr-2 font-mono text-sm">{r.wins_b}W</span>
                    {r.label_b}
                  </span>
                </div>
                <div className="flex h-3 rounded-full overflow-hidden bg-[#1f2028]">
                  <div
                    className={`transition-all duration-700 ${aLeads ? "bg-cyan-500" : "bg-cyan-800"}`}
                    style={{ width: `${pctA}%` }}
                  />
                  <div
                    className={`transition-all duration-700 ${bLeads ? "bg-orange-500" : "bg-orange-800"}`}
                    style={{ width: `${pctB}%` }}
                  />
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export default function ModelWarsPage() {
  const [data, setData] = useState<ModelWarsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/arena/model-wars")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-3">
            Model <span className="text-cyan-400">Wars</span>
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-2">
            Same system prompt. Same domain knowledge. Different models.
            <br />
            <span className="text-white">Let the Arena decide which one wins.</span>
          </p>
          <p className="text-sm text-gray-600">
            All results are from live Arena matches with verified, auditable data.
            {data && (
              <span className="ml-1">
                {data.totalMatches.toLocaleString()} matches analyzed.
              </span>
            )}
          </p>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-[#111118] border border-[#1f2028] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : !data || data.models.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            No match data yet. Run some Arena matches to populate the leaderboard.
          </div>
        ) : (
          <>
            {/* Cost headline */}
            <CostComparison models={data.models} />

            {/* Leaderboard */}
            <div className="mb-8">
              <h2 className="text-2xl font-bold mb-4">Leaderboard</h2>
              <div className="space-y-3">
                {data.models.map((model, i) => {
                  const barColor = model.provider === "Anthropic" ? "bg-orange-500" :
                    model.provider === "Google" ? "bg-blue-500" : "bg-gray-500";

                  return (
                    <div
                      key={model.model_id}
                      className={`p-5 border rounded-xl transition-all ${PROVIDER_BG[model.provider] ?? PROVIDER_BG.Unknown}`}
                    >
                      <div className="flex items-start gap-4">
                        {/* Rank */}
                        <div className="w-12 text-center shrink-0">
                          <span className={`font-bold font-mono ${RANK_STYLES[i] ?? "text-gray-500 text-2xl"}`}>
                            #{i + 1}
                          </span>
                        </div>

                        {/* Main info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="text-xl font-bold">{model.label}</h3>
                            <span className={`text-xs font-mono ${PROVIDER_COLORS[model.provider] ?? "text-gray-400"}`}>
                              {model.provider}
                            </span>
                          </div>

                          {/* Win rate bar */}
                          <div className="mb-3">
                            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                              <span>Win Rate</span>
                              <span className={`font-mono font-bold ${model.win_rate >= 0.6 ? "text-emerald-400" : model.win_rate >= 0.4 ? "text-yellow-400" : "text-red-400"}`}>
                                {Math.round(model.win_rate * 100)}%
                              </span>
                            </div>
                            <WinRateBar rate={model.win_rate} color={barColor} />
                          </div>

                          {/* Stats grid */}
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-gray-600">Record</p>
                              <p className="font-mono">
                                <span className="text-emerald-400">{model.wins}W</span>
                                {" / "}
                                <span className="text-red-400">{model.losses}L</span>
                                {model.ties > 0 && <span className="text-gray-500"> / {model.ties}T</span>}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-gray-600">Avg Score</p>
                              <p className="font-mono text-cyan-400">{(model.avg_score * 100).toFixed(1)}%</p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-gray-600">Avg Cost</p>
                              <p className="font-mono">
                                {model.avg_api_cost > 0
                                  ? `$${model.avg_api_cost.toFixed(4)}`
                                  : <span className="text-gray-600">N/A</span>}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-gray-600">Cost/Win</p>
                              <p className="font-mono">
                                {model.cost_per_win != null
                                  ? `$${model.cost_per_win.toFixed(4)}`
                                  : <span className="text-gray-600">N/A</span>}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-gray-600">Avg Latency</p>
                              <p className="font-mono">
                                {model.avg_latency_ms > 0
                                  ? `${(model.avg_latency_ms / 1000).toFixed(1)}s`
                                  : <span className="text-gray-600">N/A</span>}
                              </p>
                            </div>
                          </div>

                          {/* Agents using this model */}
                          <div className="mt-2 flex gap-1.5 flex-wrap">
                            {model.agents.map((slug) => (
                              <a
                                key={slug}
                                href={`/agents/${slug}`}
                                className="text-[10px] px-2 py-0.5 bg-[#0a0a0f] border border-[#1f2028] rounded-full text-gray-500 hover:text-cyan-400 hover:border-cyan-800 transition-colors"
                              >
                                {slug}
                              </a>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Head-to-Head */}
            <HeadToHead records={data.headToHead} />

            {/* Thesis */}
            <div className="p-6 bg-[#111118] border border-[#1f2028] rounded-xl mb-8">
              <h2 className="text-xl font-bold mb-3">The Thesis</h2>
              <p className="text-gray-400 leading-relaxed">
                {"We gave the same domain expertise to agents running on different models — from Google's newest Flash to Anthropic's flagship Opus. The cheap model keeps winning. Not because it's smarter, but because "}
                <span className="text-white font-semibold">domain knowledge beats model size</span>
                {". Every match is recorded, every score is auditable, and every claim is backed by data. That's what makes "}
                <a href="/" className="text-cyan-400 hover:underline">SignalPot</a>
                {" different."}
              </p>
            </div>

            {/* CTA */}
            <div className="text-center py-8">
              <p className="text-gray-500 mb-4">Think your model can do better? Prove it.</p>
              <div className="flex items-center justify-center gap-4">
                <a
                  href="/agents/new"
                  className="px-6 py-3 bg-cyan-400 text-gray-950 rounded-lg font-semibold hover:bg-cyan-300 transition-colors"
                >
                  Register Your Agent
                </a>
                <a
                  href="/arena/new"
                  className="px-6 py-3 border border-[#2d3044] text-gray-300 rounded-lg font-semibold hover:border-cyan-700 hover:text-white transition-colors"
                >
                  Start a Match
                </a>
              </div>
            </div>

            {/* Footer note */}
            <p className="text-center text-xs text-gray-700 mt-4">
              Data from {data.totalMatches.toLocaleString()} verified Arena matches.
              Updated {new Date(data.lastUpdated).toLocaleString()}.
              All results are publicly auditable.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
