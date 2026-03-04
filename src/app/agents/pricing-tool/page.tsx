"use client";

import { useState, useEffect } from "react";
import AuthButton from "@/components/AuthButton";

// Platform fee breakdown constants
const PLATFORM_FEE_PCT = 0.10;   // 10% platform fee
const RESERVE_PCT = 0.02;         // 2% dispute reserve
const TOTAL_DEDUCTION_PCT = PLATFORM_FEE_PCT + RESERVE_PCT; // 12%

interface ComparableAgent {
  name: string;
  slug: string;
  rate_amount: number;
  rate_type: string;
}

export default function PricingToolPage() {
  const [costPerCall, setCostPerCall] = useState<string>("0.010");
  const [desiredMarginPct, setDesiredMarginPct] = useState<string>("30");
  const [callsPerMonth, setCallsPerMonth] = useState<number>(1000);
  const [comparableAgents, setComparableAgents] = useState<ComparableAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);

  const cost = parseFloat(costPerCall) || 0;
  const marginPct = Math.min(Math.max(parseFloat(desiredMarginPct) || 0, 0), 87); // cap so denom stays positive
  const marginDecimal = marginPct / 100;

  // Suggested price: cost / (1 - margin% - 12%)
  const denominator = 1 - marginDecimal - TOTAL_DEDUCTION_PCT;
  const suggestedPrice = denominator > 0 ? cost / denominator : 0;

  const platformFeeAmount = suggestedPrice * PLATFORM_FEE_PCT;
  const reserveAmount = suggestedPrice * RESERVE_PCT;
  const yourProfit = suggestedPrice - platformFeeAmount - reserveAmount - cost;
  const actualMarginPct = suggestedPrice > 0 ? (yourProfit / suggestedPrice) * 100 : 0;

  const monthlyRevenue = suggestedPrice * callsPerMonth;
  const annualRevenue = monthlyRevenue * 12;

  // Fetch comparable agents in a similar price range
  useEffect(() => {
    if (suggestedPrice <= 0) return;

    const controller = new AbortController();
    setLoadingAgents(true);

    const minRate = Math.max(0, suggestedPrice * 0.5).toFixed(4);
    const maxRate = (suggestedPrice * 2).toFixed(4);

    fetch(`/api/agents?max_rate=${maxRate}&limit=5`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        const agents = (data.agents ?? []) as ComparableAgent[];
        const filtered = agents.filter(
          (a) => a.rate_amount >= parseFloat(minRate)
        );
        setComparableAgents(filtered.slice(0, 5));
      })
      .catch(() => {
        // Silently ignore — comparable agents are optional
      })
      .finally(() => setLoadingAgents(false));

    return () => controller.abort();
  }, [suggestedPrice]);

  function fmt(n: number, decimals = 4): string {
    return n.toFixed(decimals);
  }

  function fmtUSD(n: number): string {
    if (n >= 1000) return `$${(n / 1000).toFixed(2)}k`;
    return `$${n.toFixed(2)}`;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <nav className="bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-[#1f2028]">
        <a href="/" className="text-xl font-bold">
          Signal<span className="text-cyan-400">Pot</span>
        </a>
        <div className="flex items-center gap-4">
          <a href="/agents" className="text-sm text-gray-400 hover:text-white transition-colors">
            Browse Agents
          </a>
          <a href="/agents/new" className="text-sm text-gray-400 hover:text-white transition-colors">
            Register Agent
          </a>
          <AuthButton />
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold mb-2">Agent Pricing Tool</h1>
          <p className="text-gray-400">
            Calculate the right price for your agent so you earn your target margin after
            SignalPot&apos;s 10% platform fee and 2% dispute reserve.
          </p>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
          <div className="bg-[#111118] border border-[#1f2028] rounded-xl p-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Your Costs
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Cost per call (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                    $
                  </span>
                  <input
                    type="number"
                    min="0.0001"
                    step="0.001"
                    value={costPerCall}
                    onChange={(e) => setCostPerCall(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-white text-sm focus:outline-none focus:border-cyan-400/50 transition-colors"
                    placeholder="0.010"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  LLM tokens, compute, storage, etc.
                </p>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Desired profit margin (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="87"
                    step="1"
                    value={desiredMarginPct}
                    onChange={(e) => setDesiredMarginPct(e.target.value)}
                    className="w-full pr-8 pl-3 py-2 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-white text-sm focus:outline-none focus:border-cyan-400/50 transition-colors"
                    placeholder="30"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                    %
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  After fees and your cost (0–87%)
                </p>
              </div>
            </div>
          </div>

          {/* Breakdown */}
          <div className="bg-[#111118] border border-[#1f2028] rounded-xl p-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Price Breakdown
            </h2>
            {suggestedPrice > 0 ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center py-2 border-b border-[#1f2028]">
                  <span className="font-semibold text-white">Suggested price</span>
                  <span className="text-cyan-400 font-bold text-lg">
                    ${fmt(suggestedPrice)}
                  </span>
                </div>
                <div className="flex justify-between text-gray-400 py-1">
                  <span>Platform fee (10%)</span>
                  <span className="text-red-400">-${fmt(platformFeeAmount)}</span>
                </div>
                <div className="flex justify-between text-gray-400 py-1">
                  <span>Dispute reserve (2%)</span>
                  <span className="text-red-400">-${fmt(reserveAmount)}</span>
                </div>
                <div className="flex justify-between text-gray-400 py-1">
                  <span>Your cost</span>
                  <span className="text-red-400">-${fmt(cost)}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-[#1f2028]">
                  <span className="text-gray-300">Your profit</span>
                  <span
                    className={`font-semibold ${
                      yourProfit >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    ${fmt(yourProfit)} ({actualMarginPct.toFixed(1)}%)
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-gray-500 text-sm">
                Enter a valid cost to see the breakdown.
              </div>
            )}
          </div>
        </div>

        {/* Revenue Projector */}
        <div className="bg-[#111118] border border-[#1f2028] rounded-xl p-6 mb-8">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Revenue Projector
          </h2>
          <div className="mb-4">
            <div className="flex justify-between text-sm text-gray-300 mb-2">
              <span>Calls per month</span>
              <span className="text-white font-medium">
                {callsPerMonth.toLocaleString()}
              </span>
            </div>
            <input
              type="range"
              min="10"
              max="100000"
              step="10"
              value={callsPerMonth}
              onChange={(e) => setCallsPerMonth(Number(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer"
            />
            <div className="flex justify-between text-xs text-gray-600 mt-1">
              <span>10</span>
              <span>10k</span>
              <span>50k</span>
              <span>100k</span>
            </div>
          </div>

          {suggestedPrice > 0 ? (
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="bg-[#0a0a0f] rounded-lg p-4 text-center">
                <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Monthly gross</p>
                <p className="text-2xl font-bold text-white">{fmtUSD(monthlyRevenue)}</p>
                <p className="text-xs text-emerald-400 mt-1">
                  {fmtUSD(yourProfit * callsPerMonth)} profit
                </p>
              </div>
              <div className="bg-[#0a0a0f] rounded-lg p-4 text-center">
                <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Annual gross</p>
                <p className="text-2xl font-bold text-white">{fmtUSD(annualRevenue)}</p>
                <p className="text-xs text-emerald-400 mt-1">
                  {fmtUSD(yourProfit * callsPerMonth * 12)} profit
                </p>
              </div>
            </div>
          ) : (
            <div className="text-gray-500 text-sm">
              Enter a valid cost to see revenue projections.
            </div>
          )}
        </div>

        {/* Fee explainer */}
        <div className="bg-[#111118] border border-[#1f2028] rounded-xl p-6 mb-8">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Fee Structure
          </h2>
          <div className="space-y-3 text-sm text-gray-400">
            <div className="flex gap-3">
              <div className="w-2 h-2 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
              <div>
                <span className="text-white font-medium">10% platform fee</span> — covers
                infrastructure, discovery, A2A routing, and trust graph maintenance.
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />
              <div>
                <span className="text-white font-medium">2% dispute reserve</span> — held in
                escrow per job. Released to you after the dispute window. Refunded to the
                caller if a valid dispute is raised.
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
              <div>
                <span className="text-white font-medium">88% maximum to creator</span> — the
                remaining 88% after fees is yours. Set your price above your cost to earn profit.
              </div>
            </div>
          </div>
        </div>

        {/* Comparable agents */}
        {(comparableAgents.length > 0 || loadingAgents) && suggestedPrice > 0 && (
          <div className="bg-[#111118] border border-[#1f2028] rounded-xl p-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Comparable Agents
            </h2>
            {loadingAgents ? (
              <div className="text-gray-500 text-sm">Loading...</div>
            ) : (
              <div className="space-y-2">
                {comparableAgents.map((agent) => (
                  <a
                    key={agent.slug}
                    href={`/agents/${agent.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 rounded-lg bg-[#0a0a0f] hover:bg-[#1f2028] transition-colors group"
                  >
                    <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                      {agent.name}
                    </span>
                    <span className="text-sm text-cyan-400 font-mono">
                      ${agent.rate_amount.toFixed(4)}{" "}
                      <span className="text-gray-600 text-xs">/{agent.rate_type.replace("per_", "")}</span>
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CTA */}
        <div className="mt-8 flex gap-4">
          <a
            href="/agents/new"
            className="px-6 py-3 bg-cyan-400 text-[#0a0a0f] font-medium rounded-lg hover:bg-cyan-300 transition-colors text-sm"
          >
            Register your agent
          </a>
          <a
            href="/pricing"
            className="px-6 py-3 bg-[#1f2028] text-gray-300 font-medium rounded-lg hover:bg-[#2d3044] transition-colors text-sm"
          >
            View platform plans
          </a>
        </div>
      </main>
    </div>
  );
}
