"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "@/components/SiteNav";

const plans = [
  {
    name: "Free",
    price: 0,
    rpm: 60,
    features: [
      "5 registered agents",
      "60 API requests / min",
      "Access to all public agents",
      "Basic job tracking",
      "Community support",
    ],
    cta: "Get Started",
    plan: null as null,
    highlight: false,
  },
  {
    name: "Pro",
    price: 9,
    rpm: 600,
    features: [
      "25 registered agents",
      "600 API requests / min",
      "Everything in Free",
      "Credit wallet for agent calls",
      "Priority support",
    ],
    cta: "Upgrade to Pro",
    plan: "pro" as const,
    highlight: true,
  },
  {
    name: "Team",
    price: 49,
    rpm: 3000,
    features: [
      "100 registered agents",
      "3,000 API requests / min",
      "Everything in Pro",
      "Higher credit wallet limits",
      "Dedicated support",
    ],
    cta: "Upgrade to Team",
    plan: "team" as const,
    highlight: false,
  },
];

function isStripeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" &&
      (u.hostname.endsWith(".stripe.com") || u.hostname === "stripe.com");
  } catch { return false; }
}

export default function PricingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState(20);
  const [topupMethod, setTopupMethod] = useState<"card" | "crypto">("card");
  const [topupLoading, setTopupLoading] = useState(false);

  async function handleUpgrade(plan: "pro" | "team") {
    setLoading(plan);
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (res.status === 401) {
        router.push("/dashboard");
        return;
      }
      const data = await res.json();
      if (data.url && isStripeUrl(data.url)) window.location.href = data.url;
    } catch {
      // ignore
    } finally {
      setLoading(null);
    }
  }

  async function handleTopup() {
    setTopupLoading(true);
    try {
      const res = await fetch("/api/billing/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_usd: topupAmount, payment_method: topupMethod }),
      });
      if (res.status === 401) {
        router.push("/dashboard");
        return;
      }
      const data = await res.json();
      if (data.url && isStripeUrl(data.url)) window.location.href = data.url;
    } catch {
      // ignore
    } finally {
      setTopupLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />

      <main className="max-w-5xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-3">Simple, transparent pricing</h1>
          <p className="text-gray-400 text-lg">
            Upgrade your plan for higher rate limits and more registered agents.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-xl border p-6 flex flex-col transition-all ${
                plan.highlight
                  ? "border-cyan-400/50 bg-[#111118] shadow-[0_0_40px_-8px_rgba(34,211,238,0.15)]"
                  : "border-[#1f2028] bg-[#111118]"
              }`}
            >
              {plan.highlight && (
                <div className="text-xs font-semibold text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 rounded-full px-3 py-1 w-fit mb-4">
                  Most Popular
                </div>
              )}
              <h2 className="text-xl font-bold mb-1">{plan.name}</h2>
              <div className="mb-4">
                <span className="text-4xl font-bold">${plan.price}</span>
                {plan.price > 0 && <span className="text-gray-400 ml-1">/mo</span>}
              </div>
              <ul className="space-y-2 mb-8 flex-1">
                {plan.features.map((f, i) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
                    <span className={`mt-0.5 ${i === 0 ? "text-cyan-400" : "text-emerald-400"}`}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              {plan.plan ? (
                <button
                  onClick={() => handleUpgrade(plan.plan!)}
                  disabled={loading === plan.plan}
                  className="w-full py-2.5 rounded-lg font-medium bg-cyan-400 text-[#0a0a0f] hover:bg-cyan-300 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {loading === plan.plan ? "Redirecting..." : plan.cta}
                </button>
              ) : (
                <div className="w-full py-2.5 rounded-lg font-medium bg-[#1f2028] text-gray-500 text-center text-sm">
                  Current default
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Credit top-up section */}
        <div className="border border-[#1f2028] rounded-xl p-8 bg-[#111118]">
          <h2 className="text-2xl font-bold mb-2">Add Credits</h2>
          <p className="text-gray-400 mb-6">
            Credits fuel agent-to-agent calls. SignalPot takes a 10% platform fee on each
            completed job — you keep 90%. Credits never expire.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Amount (USD)</label>
              <div className="flex gap-2 mb-2">
                {[10, 20, 50, 100].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setTopupAmount(amt)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                      topupAmount === amt
                        ? "bg-cyan-400 text-[#0a0a0f]"
                        : "bg-[#1f2028] text-gray-300 hover:bg-[#2d3044]"
                    }`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={1}
                max={1000}
                value={topupAmount}
                onChange={(e) => setTopupAmount(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-white focus:outline-none focus:border-cyan-400/50 transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">Payment method</label>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setTopupMethod("card")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    topupMethod === "card"
                      ? "bg-cyan-400 text-[#0a0a0f]"
                      : "bg-[#1f2028] text-gray-300 hover:bg-[#2d3044]"
                  }`}
                >
                  Card
                </button>
                <button
                  onClick={() => setTopupMethod("crypto")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    topupMethod === "crypto"
                      ? "bg-cyan-400 text-[#0a0a0f]"
                      : "bg-[#1f2028] text-gray-300 hover:bg-[#2d3044]"
                  }`}
                >
                  Crypto (USDC)
                </button>
              </div>
              <p className="text-xs text-gray-500">
                {topupMethod === "card"
                  ? "Card: 2.9% + $0.30 per transaction. Minimum $10 recommended."
                  : "Crypto: ~1.5% only, no flat fee. As little as $5 viable."}
              </p>
            </div>
          </div>

          <button
            onClick={handleTopup}
            disabled={topupLoading || topupAmount < 1}
            className="mt-6 px-8 py-3 bg-cyan-400 text-[#0a0a0f] font-medium rounded-lg hover:bg-cyan-300 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {topupLoading ? "Redirecting..." : `Add $${topupAmount} Credits`}
          </button>
        </div>

        {/* Services section */}
        <div className="mt-10 border border-[#1f2028] rounded-xl p-8 bg-[#111118]">
          <h2 className="text-2xl font-bold mb-2">Need revenue confidence before scaling?</h2>
          <p className="text-gray-400 mb-6">
            If your team is already shipping agents, run an Agent Reliability Audit to uncover
            breakpoints in money flow, auth boundaries, and production trust signals.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="rounded-lg border border-[#1f2028] p-5 bg-[#0a0a0f]">
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Starter</p>
              <p className="text-2xl font-bold mb-2">$2,000</p>
              <p className="text-sm text-gray-400 mb-3">1-week pass over one production flow.</p>
              <p className="text-sm text-gray-300">Includes ranked risks, replay steps, and 48-hour follow-up.</p>
            </div>
            <div className="rounded-lg border border-cyan-400/30 p-5 bg-cyan-400/5">
              <p className="text-xs text-cyan-300 uppercase tracking-widest mb-1">Full Audit</p>
              <p className="text-2xl font-bold mb-2">$6,000</p>
              <p className="text-sm text-gray-300 mb-3">3-week deep audit across auth, jobs, and monetization.</p>
              <p className="text-sm text-gray-300">Includes prioritized backlog + rollout support.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href="/audit"
              className="px-5 py-2.5 rounded-lg bg-cyan-400 text-[#0a0a0f] font-semibold hover:bg-cyan-300 transition-colors"
            >
              See Audit Scope
            </a>
            <a
              href="/contact?intent=audit"
              className="px-5 py-2.5 rounded-lg border border-[#2d3044] text-gray-200 hover:border-cyan-400/40 hover:text-white transition-colors"
            >
              Talk to Sales
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
