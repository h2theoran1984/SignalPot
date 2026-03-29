"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "@/components/SiteNav";

type Step = "connect" | "detecting" | "confirm" | "evaluating" | "complete";

interface DetectedCapability {
  name: string;
  description?: string;
}

interface DetectionResult {
  name: string;
  description: string;
  capabilities: DetectedCapability[];
  a2aCompatible: boolean;
}

interface EvalResult {
  agentSlug: string;
  agentName: string;
  matchCount: number;
  trustScore: number;
  verifiedBadgeUrl: string;
  extractUrl: string;
  beaconSnippet: string;
}

export default function VerifyAgentPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("connect");
  const [endpoint, setEndpoint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);

  // Step 1: Detect agent from endpoint
  async function handleDetect() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/verify/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Detection failed (${res.status})`);
      }

      const data: DetectionResult = await res.json();
      setDetection(data);
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  // Step 2: Register + start evaluation
  async function handleStartEvaluation() {
    if (!detection) return;
    setLoading(true);
    setError(null);
    setStep("evaluating");

    try {
      const res = await fetch("/api/verify/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint,
          name: detection.name,
          description: detection.description,
          capabilities: detection.capabilities,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Evaluation failed (${res.status})`);
      }

      const data: EvalResult = await res.json();
      setEvalResult(data);
      setStep("complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStep("confirm");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white bg-dot-grid">
      <SiteNav />

      <main className="max-w-2xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold mb-2">Verify Your Agent</h1>
          <p className="text-gray-500">
            Already have an agent deployed? Connect it to SignalPot to get verified performance data,
            trust scores, and arena benchmarks — without changing your existing setup.
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {(["connect", "confirm", "evaluating", "complete"] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                step === s ? "border-cyan-400 text-cyan-400" :
                (["connect", "confirm", "evaluating", "complete"].indexOf(step) > i ? "border-emerald-400 text-emerald-400 bg-emerald-950/30" : "border-gray-700 text-gray-600")
              }`}>
                {["connect", "confirm", "evaluating", "complete"].indexOf(step) > i ? "\u2713" : i + 1}
              </div>
              {i < 3 && <div className={`w-12 h-px ${["connect", "confirm", "evaluating", "complete"].indexOf(step) > i ? "bg-emerald-800" : "bg-gray-800"}`} />}
            </div>
          ))}
        </div>

        {error && (
          <div className="p-4 bg-red-950/30 border border-red-900/50 rounded-lg text-sm text-red-400 mb-6">
            {error}
          </div>
        )}

        {/* ═══ Step 1: Connect ═══ */}
        {step === "connect" && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Paste your agent&apos;s endpoint</h2>
            <p className="text-sm text-gray-500 mb-4">
              We&apos;ll probe the endpoint to detect your agent&apos;s capabilities.
              Supports A2A/JSON-RPC, MCP, and standard REST endpoints.
            </p>

            <input
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://my-agent.example.com/a2a/rpc"
              className="w-full px-4 py-3 bg-[#111118] border border-[#1f2028] rounded-lg text-white focus:outline-none focus:border-cyan-400 mb-4"
            />

            <button
              onClick={handleDetect}
              disabled={loading || !endpoint}
              className="w-full py-3 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors disabled:opacity-50"
            >
              {loading ? "Detecting..." : "Detect Agent"}
            </button>

            <div className="mt-6 p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
              <p className="text-xs text-gray-500 font-medium mb-2">What happens next?</p>
              <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
                <li>We probe your endpoint for capabilities (A2A agent/card, MCP spec, or health check)</li>
                <li>You confirm the detected capabilities</li>
                <li>We run your agent through 5 pattern-based challenges</li>
                <li>You get a trust score, verified badge, and extract report</li>
                <li>Add the beacon snippet to track ongoing performance</li>
              </ol>
            </div>
          </div>
        )}

        {/* ═══ Step 2: Confirm Detection ═══ */}
        {step === "confirm" && detection && (
          <div>
            <h2 className="text-lg font-semibold mb-4">We found your agent</h2>

            <div className="p-5 bg-[#111118] border border-[#1f2028] rounded-lg mb-6">
              <div className="flex items-center gap-3 mb-3">
                {detection.a2aCompatible && (
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-emerald-950/50 text-emerald-400 border border-emerald-800/50 rounded">
                    A2A Compatible
                  </span>
                )}
              </div>
              <h3 className="text-xl font-bold text-white mb-1">{detection.name}</h3>
              <p className="text-sm text-gray-400 mb-4">{detection.description}</p>

              <p className="text-xs text-gray-500 font-medium mb-2">Detected Capabilities</p>
              <div className="space-y-2">
                {detection.capabilities.map((cap) => (
                  <div key={cap.name} className="p-3 bg-[#0d0d14] rounded border border-[#1f2028]">
                    <span className="text-sm text-cyan-400 font-mono">{cap.name}</span>
                    {cap.description && <p className="text-xs text-gray-500 mt-1">{cap.description}</p>}
                  </div>
                ))}
                {detection.capabilities.length === 0 && (
                  <p className="text-sm text-gray-500">No specific capabilities detected. We&apos;ll use general evaluation patterns.</p>
                )}
              </div>
            </div>

            <div className="p-4 bg-purple-950/20 border border-purple-800/30 rounded-lg mb-6">
              <p className="text-xs text-purple-400 font-medium mb-1">Evaluation preview</p>
              <p className="text-xs text-gray-400">
                We&apos;ll run 5 challenges against your agent: single task, routing, chain of thought,
                adversarial, and efficiency. Each tests a different behavior pattern using your agent&apos;s
                actual capabilities. Takes about 2-3 minutes.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleStartEvaluation}
                disabled={loading}
                className="flex-1 py-3 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors disabled:opacity-50"
              >
                {loading ? "Starting..." : "Start Evaluation"}
              </button>
              <button
                onClick={() => { setStep("connect"); setDetection(null); }}
                className="px-5 py-3 border border-[#1f2028] text-gray-400 rounded-lg hover:border-[#2d3044] hover:text-gray-300 transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* ═══ Step 3: Evaluating ═══ */}
        {step === "evaluating" && (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-6" />
            <h2 className="text-xl font-bold mb-2">Evaluating your agent</h2>
            <p className="text-gray-500 mb-4">Running 5 pattern-based challenges...</p>
            <div className="max-w-xs mx-auto space-y-2">
              {["Single Task", "Routing", "Chain of Thought", "Adversarial", "Efficiency"].map((p) => (
                <div key={p} className="flex items-center gap-2 text-sm text-gray-500">
                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  {p}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Step 4: Complete ═══ */}
        {step === "complete" && evalResult && (
          <div>
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-950/50 border border-emerald-800/50 rounded-full mb-4">
                <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold mb-2">
                <span className="text-cyan-400">{evalResult.agentName}</span> is verified
              </h2>
              <p className="text-gray-500">
                {evalResult.matchCount} evaluation matches completed
              </p>
            </div>

            {/* Results summary */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg text-center">
                <p className="text-xs text-gray-500 mb-1">Trust Score</p>
                <p className={`text-2xl font-bold ${evalResult.trustScore >= 0.7 ? "text-emerald-400" : evalResult.trustScore >= 0.5 ? "text-yellow-400" : "text-red-400"}`}>
                  {(evalResult.trustScore * 100).toFixed(0)}%
                </p>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg text-center">
                <p className="text-xs text-gray-500 mb-1">Matches</p>
                <p className="text-2xl font-bold text-white">{evalResult.matchCount}</p>
              </div>
            </div>

            {/* Verified badge code */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold mb-2">Add your verified badge</h3>
              <p className="text-xs text-gray-500 mb-2">
                Add this to your A2A agent card, README, or marketplace listing:
              </p>
              <pre className="p-3 bg-[#0d0d14] border border-[#1f2028] rounded text-xs text-gray-300 overflow-x-auto whitespace-pre">{evalResult.verifiedBadgeUrl}</pre>
            </div>

            {/* Beacon snippet */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold mb-2">Track ongoing performance</h3>
              <p className="text-xs text-gray-500 mb-2">
                Add the beacon to keep your trust score current and track usage:
              </p>
              <pre className="p-3 bg-[#0d0d14] border border-[#1f2028] rounded text-xs text-gray-300 overflow-x-auto whitespace-pre">{evalResult.beaconSnippet}</pre>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <a
                href={evalResult.extractUrl}
                className="flex-1 text-center px-5 py-3 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-500 transition-colors"
              >
                View Extract Report
              </a>
              <a
                href={`/agents/${evalResult.agentSlug}`}
                className="flex-1 text-center px-5 py-3 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors"
              >
                Agent Profile
              </a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
