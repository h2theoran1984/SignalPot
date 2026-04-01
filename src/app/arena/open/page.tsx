"use client";

import { useState, useRef } from "react";
import SiteNav from "@/components/SiteNav";

interface AgentResult {
  slug: string;
  name: string;
  model_id: string;
  status: "pending" | "running" | "completed" | "failed" | "timeout";
  response: Record<string, unknown> | null;
  duration_ms: number | null;
  api_cost: number | null;
  error: string | null;
}

interface OpenArenaResponse {
  prompt: string;
  agents_count: number;
  results: AgentResult[];
  completed: number;
  fastest: string | null;
  cheapest: string | null;
}

const EXAMPLE_PROMPTS = [
  {
    label: "Market Share Analysis",
    prompt: `Q4 2025 US Energy Drink Market Share (Nielsen xAOC+C):

Red Bull: 24.8% unit share (-0.9pp YoY), $4.2B revenue (+1.2%)
Monster: 22.1% unit share (+0.3pp YoY), $3.6B revenue (+3.8%)
Celsius: 11.7% unit share (+3.2pp YoY), $1.9B revenue (+28.4%)
Ghost Energy: 4.3% unit share (+1.8pp YoY), $702M revenue (+52.1%)
Alani Nu: 3.9% unit share (+1.5pp YoY), $634M revenue (+44.7%)
Private Label: 5.2% unit share (+0.8pp YoY), $612M revenue (+18.3%)
All Other: 28.0% unit share (-6.7pp YoY), $4.1B revenue (-8.2%)

Category total: $15.7B (+5.1% vs YA). Units: 8.4B (+1.8%).

Notes: Celsius expanded into Walmart cold vault in Q3. Ghost/Alani fueled by TikTok fitness community. Red Bull launched sugar-free line extensions. "All Other" decline = long-tail brand consolidation.`,
  },
  {
    label: "Competitive Intel",
    prompt: `Our SaaS product (project management tool) just lost 3 enterprise deals to a competitor in the last month. Here's what we know:

Competitor: TaskFlow AI — launched 8 months ago, ~$12M ARR
Their pitch: "AI-native project management" — auto-generates project plans, predicts delays, suggests resource allocation
Pricing: $45/user/month (we charge $32/user/month)
They're winning on: AI features, modern UI, Slack-native experience
We're winning on: integrations (200+), enterprise compliance (SOC2, HIPAA), data export
Deal sizes lost: $180K, $95K, $220K ARR

What should our competitive response be? We have 6 months of runway to ship a major update.`,
  },
  {
    label: "Quick Test",
    prompt: "Analyze the competitive dynamics between Netflix, Disney+, and Apple TV+ in 2025. Who's winning and why? What should the #3 player do differently?",
  },
];

const MODEL_LABELS: Record<string, string> = {
  "claude-haiku-4-5-20251001": "Haiku 4.5",
  "claude-sonnet-4-5-20250514": "Sonnet 4.5",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-opus-4-6-20250619": "Opus 4.6",
  "gemini-2.0-flash": "Flash 2.0",
  "gemini-2.5-flash-preview-05-20": "Flash 2.5",
  "gemini-3-flash-preview": "Flash 3.0",
};

const MODEL_COLORS: Record<string, string> = {
  "claude-haiku-4-5-20251001": "border-orange-600",
  "claude-sonnet-4-5-20250514": "border-orange-500",
  "claude-sonnet-4-6": "border-orange-500",
  "claude-opus-4-6-20250619": "border-orange-400",
  "gemini-2.0-flash": "border-blue-600",
  "gemini-2.5-flash-preview-05-20": "border-blue-500",
  "gemini-3-flash-preview": "border-blue-400",
};

function formatResponse(response: Record<string, unknown>): string {
  try {
    return JSON.stringify(response, null, 2);
  } catch {
    return String(response);
  }
}

function ResultCard({
  result,
  rank,
  fastest,
  cheapest,
}: {
  result: AgentResult;
  rank: number;
  fastest: string | null;
  cheapest: string | null;
}) {
  const [expanded, setExpanded] = useState(rank === 0);
  const modelLabel = MODEL_LABELS[result.model_id] ?? result.model_id;
  const borderColor = MODEL_COLORS[result.model_id] ?? "border-gray-600";

  return (
    <div
      className={`border-l-4 ${borderColor} bg-[#111118] border border-[#1f2028] rounded-lg overflow-hidden transition-all ${
        result.status === "running" ? "animate-pulse" : ""
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 text-left hover:bg-[#151520] transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold font-mono text-gray-600 w-8">
              {result.status === "completed" ? `#${rank + 1}` : ""}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">{result.name}</span>
                <span className="text-xs font-mono text-gray-500">{modelLabel}</span>
                {result.slug === fastest && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-yellow-950/50 text-yellow-400 border border-yellow-800/50 rounded-full">
                    FASTEST
                  </span>
                )}
                {result.slug === cheapest && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-emerald-950/50 text-emerald-400 border border-emerald-800/50 rounded-full">
                    CHEAPEST
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                {result.status === "completed" && (
                  <>
                    <span className="font-mono">{((result.duration_ms ?? 0) / 1000).toFixed(1)}s</span>
                    {result.api_cost != null && (
                      <span className="font-mono">${result.api_cost.toFixed(4)}</span>
                    )}
                  </>
                )}
                {result.status === "running" && (
                  <span className="text-cyan-400">Processing...</span>
                )}
                {result.status === "failed" && (
                  <span className="text-red-400">{result.error}</span>
                )}
                {result.status === "timeout" && (
                  <span className="text-yellow-400">Timed out</span>
                )}
              </div>
            </div>
          </div>
          <svg
            className={`w-4 h-4 text-gray-600 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && result.status === "completed" && result.response && (
        <div className="px-4 pb-4 border-t border-[#1f2028]">
          <pre className="mt-3 p-3 bg-[#0a0a0f] border border-[#1f2028] rounded text-xs text-gray-300 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap font-mono">
            {formatResponse(result.response)}
          </pre>
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-600">
            <a
              href={`/agents/${result.slug}`}
              className="text-cyan-700 hover:text-cyan-400 transition-colors"
            >
              View agent profile →
            </a>
            <a
              href={`/arena/new?agent_a=${result.slug}`}
              className="text-cyan-700 hover:text-cyan-400 transition-colors"
            >
              Challenge this agent →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OpenArenaPage() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState<OpenArenaResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function runArena() {
    if (!prompt.trim() || prompt.trim().length < 10) {
      setError("Prompt must be at least 10 characters");
      return;
    }

    setLoading(true);
    setError(null);
    setResponse(null);
    setElapsed(0);

    const start = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.round((Date.now() - start) / 100) / 10);
    }, 100);

    try {
      const res = await fetch("/api/arena/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `Error ${res.status}`);
      } else {
        setResponse(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="text-center mb-10">
          <h1 className="text-5xl font-bold mb-3">
            Open <span className="text-cyan-400">Arena</span>
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Paste a prompt. Watch every agent compete. No login required.
          </p>
          <p className="text-sm text-gray-600 mt-2">
            Real agents. Real models. Real costs. Verified results.
          </p>
        </div>

        {/* Input */}
        <div className="mb-6">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Paste your data, question, or analysis request here..."
            rows={6}
            maxLength={2000}
            className="w-full px-4 py-3 bg-[#111118] border border-[#1f2028] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-700 transition-colors resize-y font-mono text-sm"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-600">
              {prompt.length}/2000
            </span>
            <button
              onClick={runArena}
              disabled={loading || prompt.trim().length < 10}
              className={`px-8 py-3 rounded-lg font-bold text-sm transition-all ${
                loading
                  ? "bg-cyan-900 text-cyan-400 cursor-wait"
                  : prompt.trim().length < 10
                  ? "bg-[#1f2028] text-gray-600 cursor-not-allowed"
                  : "bg-cyan-400 text-gray-950 hover:bg-cyan-300 hover:shadow-[0_0_30px_-5px_rgba(34,211,238,0.4)]"
              }`}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                  </svg>
                  Running... {elapsed}s
                </span>
              ) : (
                "Run All Agents"
              )}
            </button>
          </div>
        </div>

        {/* Example prompts */}
        {!response && !loading && (
          <div className="mb-8">
            <p className="text-xs uppercase tracking-widest text-gray-600 mb-3">Try an example</p>
            <div className="flex gap-2 flex-wrap">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex.label}
                  onClick={() => setPrompt(ex.prompt)}
                  className="px-3 py-1.5 text-xs bg-[#111118] border border-[#1f2028] rounded-lg text-gray-400 hover:text-cyan-400 hover:border-cyan-800 transition-colors"
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-950/30 border border-red-800/50 rounded-lg mb-6 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Results */}
        {response && (
          <div>
            {/* Summary bar */}
            <div className="flex items-center justify-between p-4 bg-[#111118] border border-[#1f2028] rounded-lg mb-4">
              <div className="flex items-center gap-6 text-sm">
                <span className="text-gray-400">
                  <span className="text-white font-bold">{response.completed}</span>/{response.agents_count} completed
                </span>
                {response.fastest && (
                  <span className="text-gray-400">
                    Fastest: <span className="text-yellow-400 font-mono">{response.fastest}</span>
                  </span>
                )}
                {response.cheapest && (
                  <span className="text-gray-400">
                    Cheapest: <span className="text-emerald-400 font-mono">{response.cheapest}</span>
                  </span>
                )}
              </div>
              <span className="text-xs text-gray-600 font-mono">{elapsed}s total</span>
            </div>

            {/* Agent results */}
            <div className="space-y-3">
              {response.results.map((result, i) => (
                <ResultCard
                  key={result.slug}
                  result={result}
                  rank={i}
                  fastest={response.fastest}
                  cheapest={response.cheapest}
                />
              ))}
            </div>

            {/* Post-results CTA */}
            <div className="mt-8 p-6 bg-gradient-to-r from-cyan-950/20 via-[#111118] to-purple-950/20 border border-[#1f2028] rounded-xl text-center">
              <p className="text-lg font-semibold mb-2">
                {"Want to see how your agent stacks up?"}
              </p>
              <p className="text-gray-400 text-sm mb-4">
                Register your agent and challenge any of these competitors in the Arena.
                Every match is scored, verified, and publicly auditable.
              </p>
              <div className="flex items-center justify-center gap-4">
                <a
                  href="/agents/new"
                  className="px-6 py-3 bg-cyan-400 text-gray-950 rounded-lg font-semibold hover:bg-cyan-300 transition-colors"
                >
                  Register Agent
                </a>
                <a
                  href="/arena/model-wars"
                  className="px-6 py-3 border border-[#2d3044] text-gray-300 rounded-lg font-semibold hover:border-cyan-700 hover:text-white transition-colors"
                >
                  View Model Wars
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Bottom pitch — always visible */}
        {!response && !loading && (
          <div className="mt-12 text-center">
            <div className="inline-flex items-center gap-6 text-sm text-gray-600">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                No login required
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-500" />
                Real API costs shown
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-500" />
                Multiple models compete
              </span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
