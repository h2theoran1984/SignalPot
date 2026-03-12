"use client";

import { useState } from "react";
import SiteNav from "@/components/SiteNav";
import { Button } from "@/components/ui/button";

interface Suggestion {
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
}

interface Analysis {
  score: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: Suggestion[];
  improved_prompt: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-950 text-red-400 border-red-900",
  medium: "bg-yellow-950 text-yellow-400 border-yellow-900",
  low: "bg-gray-900 text-gray-400 border-gray-800",
};

export default function PromptAdvisorPage() {
  const [systemPrompt, setSystemPrompt] = useState("");
  const [capability, setCapability] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showImproved, setShowImproved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleAnalyze() {
    if (!systemPrompt.trim() || !capability.trim()) return;

    setAnalyzing(true);
    setResult(null);
    setError(null);
    setShowImproved(false);

    try {
      const res = await fetch("/api/tools/prompt-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_prompt: systemPrompt.trim(),
          capability: capability.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      const data = await res.json();
      setResult(data.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAnalyzing(false);
    }
  }

  function handleCopy() {
    if (!result?.improved_prompt) return;
    navigator.clipboard.writeText(result.improved_prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white bg-dot-grid">
      <SiteNav />

      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">
          Prompt <span className="text-purple-400">Advisor</span>
        </h1>
        <p className="text-gray-400 mb-8">
          Paste any system prompt and get actionable improvement suggestions. Free, no account needed.
          Works with any LLM — not just SignalPot agents.
        </p>

        {/* Input form */}
        {!analyzing && !result && (
          <div className="space-y-5">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-300">System Prompt</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Paste your system prompt here..."
                rows={10}
                className="w-full px-4 py-3 bg-[#111118] border border-[#1f2028] rounded-lg text-white placeholder-gray-600 transition-colors focus:outline-none focus:border-purple-700 font-mono text-sm resize-y"
              />
              <p className="text-xs text-gray-600">
                {systemPrompt.length.toLocaleString()} / 10,000 characters
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-300">
                What does this prompt do?
              </label>
              <input
                type="text"
                value={capability}
                onChange={(e) => setCapability(e.target.value)}
                placeholder="e.g. Summarize meeting transcripts, Extract action items, Analyze sentiment"
                className="w-full px-4 py-2.5 bg-[#111118] border border-[#1f2028] rounded-lg text-white placeholder-gray-600 transition-colors focus:outline-none focus:border-purple-700"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-950/50 border border-red-900 rounded-lg text-sm text-red-400">
                {error}
              </div>
            )}

            <Button
              variant="brand"
              size="lg"
              onClick={handleAnalyze}
              disabled={!systemPrompt.trim() || !capability.trim() || systemPrompt.length > 10000}
              className="w-full"
            >
              Analyze Prompt
            </Button>
          </div>
        )}

        {/* Analyzing state */}
        {analyzing && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-10 h-10 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-purple-400 font-medium">Analyzing your prompt...</p>
            <p className="text-sm text-gray-500">This usually takes 5-10 seconds</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Score */}
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full border-2 border-purple-700/50 bg-purple-950/30 mb-3">
                <span className={`text-3xl font-bold ${
                  result.score >= 8 ? "text-emerald-400" :
                  result.score >= 5 ? "text-yellow-400" :
                  "text-red-400"
                }`}>
                  {result.score}
                </span>
                <span className="text-gray-600 text-sm">/10</span>
              </div>
              <p className="text-sm text-gray-500">Prompt Quality Score</p>
            </div>

            {/* Strengths & Weaknesses */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <h3 className="text-sm font-semibold text-emerald-400 mb-2">Strengths</h3>
                <ul className="space-y-1.5">
                  {result.strengths.map((s, i) => (
                    <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                      <span className="text-emerald-400 mt-0.5 shrink-0">+</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <h3 className="text-sm font-semibold text-red-400 mb-2">Weaknesses</h3>
                <ul className="space-y-1.5">
                  {result.weaknesses.map((w, i) => (
                    <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                      <span className="text-red-400 mt-0.5 shrink-0">-</span>
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Suggestions */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Suggestions</h3>
              <div className="space-y-2">
                {result.suggestions.map((s, i) => (
                  <div
                    key={i}
                    className="p-3 bg-[#111118] border border-[#1f2028] rounded-lg"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 text-[10px] rounded border font-bold uppercase ${
                          PRIORITY_COLORS[s.priority] ?? PRIORITY_COLORS.low
                        }`}
                      >
                        {s.priority}
                      </span>
                      <span className="text-sm font-medium text-white">{s.title}</span>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">{s.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Improved prompt */}
            <div>
              <button
                onClick={() => setShowImproved(!showImproved)}
                className="flex items-center gap-2 text-sm font-semibold text-purple-400 hover:text-purple-300 transition-colors cursor-pointer"
              >
                <svg
                  className={`w-3 h-3 transition-transform ${showImproved ? "rotate-90" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                {showImproved ? "Hide" : "Show"} Improved Prompt
              </button>

              {showImproved && (
                <div className="mt-3">
                  <div className="relative">
                    <pre className="p-4 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-sm text-gray-300 font-mono whitespace-pre-wrap overflow-x-auto max-h-96">
                      {result.improved_prompt}
                    </pre>
                    <button
                      onClick={handleCopy}
                      className="absolute top-2 right-2 px-2.5 py-1 text-xs bg-[#111118] border border-[#1f2028] rounded text-gray-400 hover:text-white hover:border-gray-600 transition-colors cursor-pointer"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* CTA */}
            <div className="p-4 bg-cyan-950/20 border border-cyan-800/30 rounded-lg text-center">
              <p className="text-sm text-gray-400 mb-2">
                Want to test this prompt against real opponents?
              </p>
              <a
                href="/arena"
                className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-400 text-gray-950 font-semibold text-sm rounded-lg hover:bg-cyan-300 transition-colors"
              >
                Enter the Arena
              </a>
            </div>

            {/* Reset */}
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setResult(null);
                setError(null);
                setShowImproved(false);
              }}
              className="w-full"
            >
              Analyze Another Prompt
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
