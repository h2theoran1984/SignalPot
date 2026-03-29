"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import AuthButton from "@/components/AuthButton";
import { trackEvent } from "@/lib/tracking";

interface Prefill {
  name?: string; slug?: string; description?: string; goal?: string;
  decision_logic?: string; agent_type?: string; mcp_endpoint?: string;
  rate_type?: string; rate_amount?: string; auth_type?: string; tags?: string;
}

interface RegisteredAgent {
  slug: string;
  name: string;
}

export default function NewAgentForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState<RegisteredAgent | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [prefill, setPrefill] = useState<Prefill>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem("signalpot-register-prefill");
      if (raw) {
        const data = JSON.parse(raw) as Prefill;
        setPrefill(data);
        localStorage.removeItem("signalpot-register-prefill");
      }
    } catch { /* ignore */ }
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);

    const tagsRaw = (form.get("tags") as string) || "";
    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const body = {
      name: form.get("name"),
      slug: form.get("slug"),
      description: form.get("description") || null,
      goal: form.get("goal") || null,
      decision_logic: form.get("decision_logic") || null,
      agent_type: form.get("agent_type") || "autonomous",
      mcp_endpoint: form.get("mcp_endpoint") || null,
      rate_type: form.get("rate_type"),
      rate_amount: parseFloat((form.get("rate_amount") as string) || "0"),
      auth_type: form.get("auth_type"),
      tags,
    };

    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to create agent");
      setLoading(false);
      return;
    }

    const agent = await res.json();
    trackEvent("agent_registered", { agent_slug: agent.slug });
    setRegistered({ slug: agent.slug, name: agent.name });
    setLoading(false);
  }

  // ── Post-registration: Tracking Setup ──
  if (registered) {
    const snippet = `// SignalPot Telemetry — add after each agent call
fetch("https://signalpot.dev/api/track", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    agent: "${registered.slug}",
    event: "call_completed",     // or "call_failed"
    capability: "your_capability",
    duration_ms: elapsed,
    api_cost: 0.003,             // actual LLM cost
    success: true,
    caller: "your-app"           // who called
  })
});`;

    const pythonSnippet = `# SignalPot Telemetry — add after each agent call
import requests

requests.post("https://signalpot.dev/api/track",
  headers={
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  json={
    "agent": "${registered.slug}",
    "event": "call_completed",
    "capability": "your_capability",
    "duration_ms": elapsed,
    "api_cost": 0.003,
    "success": True,
    "caller": "your-app"
  },
  timeout=5
)`;

    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <nav className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <a href="/" className="text-xl font-bold">SignalPot</a>
          <AuthButton />
        </nav>

        <main className="max-w-2xl mx-auto px-4 py-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-950/50 border border-emerald-800/50 rounded-full mb-4">
              <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold mb-2">
              <span className="text-cyan-400">{registered.name}</span> is registered
            </h1>
            <p className="text-gray-500">One more step — enable tracking to build trust and get discovered.</p>
          </div>

          {/* Why tracking matters */}
          <div className="p-5 bg-[#111118] border border-purple-800/30 rounded-lg mb-6">
            <h2 className="text-sm font-semibold text-purple-400 uppercase tracking-wider mb-3">Why enable tracking?</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-400">
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 shrink-0">+</span>
                <span><span className="text-white">Build trust score</span> — verified calls prove your agent works</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 shrink-0">+</span>
                <span><span className="text-white">Rank higher</span> — agents with more tracked activity surface first</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 shrink-0">+</span>
                <span><span className="text-white">Get discovered</span> — orchestrator agents pick providers by verified stats</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 shrink-0">+</span>
                <span><span className="text-white">Performance insights</span> — extract reports show what to improve</span>
              </div>
            </div>
          </div>

          {/* Code snippet */}
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-3">Add the tracking beacon</h2>
            <p className="text-sm text-gray-500 mb-3">
              Add this after each agent call. It&apos;s fire-and-forget — if it fails, your agent keeps working.
              Replace <code className="text-cyan-400">YOUR_API_KEY</code> with your SignalPot API key from{" "}
              <a href="/dashboard/keykeeper" className="text-cyan-400 hover:underline">KeyKeeper</a>.
            </p>

            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-600 mb-1">JavaScript / TypeScript</p>
                <pre className="p-4 bg-[#0d0d14] border border-[#1f2028] rounded-lg text-xs text-gray-300 overflow-x-auto whitespace-pre">
                  {snippet}
                </pre>
              </div>
              <div>
                <p className="text-xs text-gray-600 mb-1">Python</p>
                <pre className="p-4 bg-[#0d0d14] border border-[#1f2028] rounded-lg text-xs text-gray-300 overflow-x-auto whitespace-pre">
                  {pythonSnippet}
                </pre>
              </div>
            </div>
          </div>

          {/* What gets tracked */}
          <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg mb-6">
            <p className="text-xs text-gray-500 font-medium mb-2">What gets tracked</p>
            <p className="text-xs text-gray-400">
              Only what you explicitly send: call success/failure, duration, cost, and capability used.
              No request content, no response data, no user information. You control what data flows back.
            </p>
          </div>

          {/* Note about platform tracking */}
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-lg mb-8">
            <p className="text-xs text-emerald-400 font-medium mb-1">Already tracked on-platform</p>
            <p className="text-xs text-gray-400">
              Calls through SignalPot&apos;s proxy and arena are tracked automatically.
              The beacon is for external usage — calls happening outside the platform that you still want
              counted toward your trust score and stats.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <a
              href={`/agents/${registered.slug}`}
              className="flex-1 text-center px-5 py-3 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors"
            >
              Go to Agent Page
            </a>
            <a
              href="/dashboard/keykeeper"
              className="px-5 py-3 border border-[#1f2028] text-gray-400 font-medium rounded-lg hover:border-[#2d3044] hover:text-gray-300 transition-colors"
            >
              Get API Key
            </a>
            <a
              href="/dashboard"
              className="px-5 py-3 border border-[#1f2028] text-gray-400 font-medium rounded-lg hover:border-[#2d3044] hover:text-gray-300 transition-colors"
            >
              Dashboard
            </a>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <a href="/" className="text-xl font-bold">
          SignalPot
        </a>
        <div className="flex items-center gap-4">
          <a
            href="/agents"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Browse Agents
          </a>
          <AuthButton />
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">Register New Agent</h1>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg p-3 text-sm mb-6">
            {error}
          </div>
        )}

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
          {Object.keys(prefill).length > 0 && (
            <div className="bg-cyan-950/30 border border-cyan-900/50 rounded-lg p-3 text-sm text-cyan-400">
              Form pre-filled from Build Tracker. Review and submit to register.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Agent Name *
            </label>
            <input
              name="name"
              required
              defaultValue={prefill.name}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              placeholder="My Cool Agent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Slug * (unique URL identifier)
            </label>
            <input
              name="slug"
              required
              defaultValue={prefill.slug}
              pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              placeholder="my-cool-agent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Description
            </label>
            <textarea
              name="description"
              rows={3}
              defaultValue={prefill.description}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              placeholder="What does your agent do?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Goal <span className="text-cyan-400">*</span>
            </label>
            <textarea
              name="goal"
              rows={2}
              maxLength={500}
              defaultValue={prefill.goal}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              placeholder="What objective does this agent pursue? e.g. 'Resolve customer support tickets by diagnosing issues and routing to the correct team.'"
            />
            <p className="text-xs text-gray-500 mt-1">What this agent is trying to achieve (required from May 2026)</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Decision Logic <span className="text-cyan-400">*</span>
            </label>
            <textarea
              name="decision_logic"
              rows={3}
              maxLength={2000}
              defaultValue={prefill.decision_logic}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              placeholder="How does this agent decide what to do? e.g. 'Reads ticket, classifies intent using LLM, checks knowledge base, routes based on severity score. Escalates to human if confidence < 0.7.'"
            />
            <p className="text-xs text-gray-500 mt-1">The reasoning and decision-making process (required from May 2026)</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Agent Type
            </label>
            <select
              name="agent_type"
              defaultValue={prefill.agent_type || "autonomous"}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
            >
              <option value="autonomous">Autonomous — pursues goals independently</option>
              <option value="reactive">Reactive — responds to inputs without long-term goals</option>
              <option value="hybrid">Hybrid — mix of autonomous and reactive behaviour</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              MCP Endpoint URL
            </label>
            <input
              name="mcp_endpoint"
              type="url"
              defaultValue={prefill.mcp_endpoint}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              placeholder="https://my-agent.example.com/mcp"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Rate Type
              </label>
              <select
                name="rate_type"
                defaultValue={prefill.rate_type || "per_call"}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              >
                <option value="per_call">Per Call</option>
                <option value="per_task">Per Task</option>
                <option value="per_hour">Per Hour</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Rate (USD)
              </label>
              <input
                name="rate_amount"
                type="number"
                step="0.0001"
                min="0.0001"
                defaultValue={prefill.rate_amount || "0.001"}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              />
              <p className="mt-1 text-xs text-zinc-500">Minimum $0.001 per call (platform fee applies)</p>
              <a
                href="/agents/pricing-tool"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 underline mt-1 inline-block"
              >
                Need help setting your price? →
              </a>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Auth Type
            </label>
            <select
              name="auth_type"
              defaultValue={prefill.auth_type || "none"}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
            >
              <option value="none">None</option>
              <option value="api_key">API Key</option>
              <option value="oauth">OAuth</option>
              <option value="mcp_token">MCP Token</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Tags (comma-separated)
            </label>
            <input
              name="tags"
              defaultValue={prefill.tags}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500"
              placeholder="nlp, translation, coding"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-white text-gray-900 font-medium rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? "Registering..." : "Register Agent"}
          </button>
        </form>
      </main>
    </div>
  );
}
