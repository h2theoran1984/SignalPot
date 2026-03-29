"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import SiteNav from "@/components/SiteNav";

// Marketplace Activation Landing Page
// All marketplaces redirect here after purchase with a token + provider.
// Flow: marketplace → this page → resolves token → activates subscription → shows confirmation.
//
// URL: /marketplace/activate?provider=azure&token=xxx

type ActivationState = "loading" | "success" | "error";

interface ActivationResult {
  subscription_id: string;
  agent_name: string;
  agent_slug: string;
  provider: string;
  plan_id: string | null;
}

export default function MarketplaceActivatePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0f] text-white bg-dot-grid flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <MarketplaceActivateContent />
    </Suspense>
  );
}

function MarketplaceActivateContent() {
  const searchParams = useSearchParams();
  const provider = searchParams.get("provider");
  const token = searchParams.get("token");

  const [state, setState] = useState<ActivationState>("loading");
  const [result, setResult] = useState<ActivationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function activate() {
      if (!provider || !token) {
        setError("Missing provider or token in URL.");
        setState("error");
        return;
      }

      try {
        const res = await fetch("/api/marketplace/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, token }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? `Activation failed (${res.status})`);
        }

        const data: ActivationResult = await res.json();
        setResult(data);
        setState("success");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setState("error");
      }
    }

    activate();
  }, [provider, token]);

  const providerLabel: Record<string, string> = {
    azure: "Azure Marketplace",
    google_cloud: "Google Cloud Marketplace",
    aws: "AWS Marketplace",
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white bg-dot-grid">
      <SiteNav />

      <main className="max-w-xl mx-auto px-4 py-20">
        {/* Loading */}
        {state === "loading" && (
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-6" />
            <h1 className="text-2xl font-bold mb-2">Activating your subscription</h1>
            <p className="text-gray-500">
              Connecting your {providerLabel[provider ?? ""] ?? "marketplace"} purchase to SignalPot...
            </p>
          </div>
        )}

        {/* Success */}
        {state === "success" && result && (
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-950/50 border border-emerald-800/50 rounded-full mb-6">
              <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-2">Subscription Active</h1>
            <p className="text-gray-400 mb-6">
              Your {providerLabel[result.provider] ?? result.provider} subscription for{" "}
              <span className="text-cyan-400 font-semibold">{result.agent_name}</span> is now active.
            </p>

            <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg text-left mb-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-500">Agent</span>
                <span className="text-white">{result.agent_name}</span>
              </div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-500">Marketplace</span>
                <span className="text-white">{providerLabel[result.provider] ?? result.provider}</span>
              </div>
              {result.plan_id && (
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-500">Plan</span>
                  <span className="text-white">{result.plan_id}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subscription ID</span>
                <span className="text-gray-400 font-mono text-xs">{result.subscription_id}</span>
              </div>
            </div>

            <div className="flex items-center justify-center gap-3">
              <a
                href={`/agents/${result.agent_slug}`}
                className="px-5 py-2.5 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors"
              >
                Go to Agent
              </a>
              <a
                href="/dashboard"
                className="px-5 py-2.5 border border-[#1f2028] text-gray-400 rounded-lg hover:border-[#2d3044] hover:text-gray-300 transition-colors"
              >
                Dashboard
              </a>
            </div>
          </div>
        )}

        {/* Error */}
        {state === "error" && (
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-950/50 border border-red-800/50 rounded-full mb-6">
              <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-2">Activation Failed</h1>
            <p className="text-gray-400 mb-2">{error}</p>
            <p className="text-sm text-gray-600 mb-6">
              If this keeps happening, contact support with your marketplace order details.
            </p>
            <a
              href="/dashboard"
              className="px-5 py-2.5 border border-[#1f2028] text-gray-400 rounded-lg hover:border-[#2d3044] hover:text-gray-300 transition-colors"
            >
              Go to Dashboard
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
