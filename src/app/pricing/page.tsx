"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AuthButton from "@/components/AuthButton";

const plans = [
  {
    name: "Free",
    price: 0,
    rpm: 60,
    features: [
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
      if (data.url) window.location.href = data.url;
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
      if (data.url) window.location.href = data.url;
    } catch {
      // ignore
    } finally {
      setTopupLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <a href="/" className="text-xl font-bold">SignalPot</a>
        <div className="flex items-center gap-4">
          <a href="/agents" className="text-sm text-gray-400 hover:text-white transition-colors">
            Browse Agents
          </a>
          <a href="/dashboard" className="text-sm text-gray-400 hover:text-white transition-colors">
            Dashboard
          </a>
          <AuthButton />
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-3">Simple, transparent pricing</h1>
          <p className="text-gray-400 text-lg">
            Upgrade your plan for higher API rate limits. Add credits to pay for agent-to-agent calls.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-xl border p-6 flex flex-col ${
                plan.highlight
                  ? "border-white bg-gray-900"
                  : "border-gray-800 bg-gray-900/50"
              }`}
            >
              {plan.highlight && (
                <div className="text-xs font-semibold text-white bg-white/10 rounded-full px-3 py-1 w-fit mb-4">
                  Most Popular
                </div>
              )}
              <h2 className="text-xl font-bold mb-1">{plan.name}</h2>
              <div className="mb-4">
                <span className="text-4xl font-bold">${plan.price}</span>
                {plan.price > 0 && <span className="text-gray-400 ml-1">/mo</span>}
              </div>
              <ul className="space-y-2 mb-8 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
                    <span className="mt-0.5 text-green-400">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              {plan.plan ? (
                <button
                  onClick={() => handleUpgrade(plan.plan!)}
                  disabled={loading === plan.plan}
                  className="w-full py-2.5 rounded-lg font-medium bg-white text-gray-900 hover:bg-gray-200 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {loading === plan.plan ? "Redirecting..." : plan.cta}
                </button>
              ) : (
                <div className="w-full py-2.5 rounded-lg font-medium bg-gray-800 text-gray-400 text-center text-sm">
                  Current default
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Credit top-up section */}
        <div className="border border-gray-800 rounded-xl p-8 bg-gray-900/50">
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
                        ? "bg-white text-gray-900"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700"
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
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">Payment method</label>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setTopupMethod("card")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    topupMethod === "card"
                      ? "bg-white text-gray-900"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  Card
                </button>
                <button
                  onClick={() => setTopupMethod("crypto")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    topupMethod === "crypto"
                      ? "bg-white text-gray-900"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
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
            className="mt-6 px-8 py-3 bg-white text-gray-900 font-medium rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {topupLoading ? "Redirecting..." : `Add $${topupAmount} Credits`}
          </button>
        </div>
      </main>
    </div>
  );
}
