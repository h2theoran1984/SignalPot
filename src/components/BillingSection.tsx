"use client";

import { useState } from "react";

interface Props {
  plan: string;
  creditBalanceMillicents: number;
}

function isStripeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" &&
      (u.hostname.endsWith(".stripe.com") || u.hostname === "stripe.com");
  } catch { return false; }
}

export default function BillingSection({ plan, creditBalanceMillicents }: Props) {
  const [portalLoading, setPortalLoading] = useState(false);
  const [topupLoading, setTopupLoading] = useState(false);

  const creditsDollars = (creditBalanceMillicents / 100_000).toFixed(4);

  const planLabel =
    plan === "pro" ? "Pro" : plan === "team" ? "Team" : "Free";

  const planColor =
    plan === "pro"
      ? "bg-blue-900/50 text-blue-300"
      : plan === "team"
        ? "bg-purple-900/50 text-purple-300"
        : "bg-gray-800 text-gray-400";

  async function handlePortal() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (data.url && isStripeUrl(data.url)) window.location.href = data.url;
      else if (data.error) alert(typeof data.error === "string" ? data.error : "An error occurred");
    } finally {
      setPortalLoading(false);
    }
  }

  async function handleTopup(amountUsd: number) {
    setTopupLoading(true);
    try {
      const res = await fetch("/api/billing/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_usd: amountUsd, payment_method: "card" }),
      });
      const data = await res.json();
      if (data.url && isStripeUrl(data.url)) window.location.href = data.url;
    } finally {
      setTopupLoading(false);
    }
  }

  return (
    <div className="border border-gray-800 rounded-xl p-6 bg-gray-900/50 mb-8">
      <h2 className="text-xl font-semibold mb-4">Billing</h2>

      <div className="flex flex-wrap gap-6 items-start">
        {/* Plan */}
        <div className="flex-1 min-w-48">
          <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Plan</p>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 text-sm rounded font-medium ${planColor}`}>
              {planLabel}
            </span>
            {plan === "free" ? (
              <a
                href="/pricing"
                className="text-sm text-white underline hover:text-gray-300"
              >
                Upgrade
              </a>
            ) : (
              <button
                onClick={handlePortal}
                disabled={portalLoading}
                className="text-sm text-gray-400 hover:text-white underline transition-colors cursor-pointer disabled:opacity-50"
              >
                {portalLoading ? "Loading..." : "Manage"}
              </button>
            )}
          </div>
        </div>

        {/* Credit balance */}
        <div className="flex-1 min-w-48">
          <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Credit Balance</p>
          <p className="text-lg font-medium">${creditsDollars}</p>
        </div>

        {/* Add credits */}
        <div className="flex gap-2">
          {[10, 20, 50].map((amt) => (
            <button
              key={amt}
              onClick={() => handleTopup(amt)}
              disabled={topupLoading}
              className="px-4 py-2 bg-white text-gray-900 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium cursor-pointer disabled:opacity-50"
            >
              +${amt}
            </button>
          ))}
          <a
            href="/pricing"
            className="px-4 py-2 border border-gray-700 text-gray-300 rounded-lg hover:border-gray-500 transition-colors text-sm font-medium"
          >
            More options
          </a>
        </div>
      </div>
    </div>
  );
}
