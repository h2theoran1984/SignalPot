"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "@/components/SiteNav";

interface AgentOption {
  id: string;
  name: string;
  slug: string;
  capability_schema: Array<{ name: string; description: string }>;
  rate_amount: number;
}

export default function NewMatchPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <NewMatchPage />
    </Suspense>
  );
}

function NewMatchPage() {
  const router = useRouter();

  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentA, setAgentA] = useState("");
  const [agentB, setAgentB] = useState("");
  const [capability, setCapability] = useState("");
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [challengerElo, setChallengerElo] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Load agents
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/agents?limit=100");
        if (res.ok) {
          const data = await res.json();
          setAgents(
            (data.agents ?? []).filter((a: AgentOption) => a.capability_schema?.length > 0)
          );
        }
      } catch {
        setError("Failed to load agents");
      }
    }
    load();
  }, []);

  // Get agent A object
  const agentAObj = agents.find((a) => a.slug === agentA);
  const agentBObj = agents.find((a) => a.slug === agentB);

  // Detect sparring partner involvement
  const hasSparring = agentA === "sparring-partner" || agentB === "sparring-partner";
  const challengerSlug = hasSparring
    ? (agentA === "sparring-partner" ? agentB : agentA) || null
    : null;

  // Level config
  const LEVELS = [
    { level: 1, label: "Level 1", description: "Haiku · Basic prompts", elo: 0 },
    { level: 2, label: "Level 2", description: "Sonnet · Enhanced prompts", elo: 1300 },
    { level: 3, label: "Level 3", description: "Opus · Master prompts", elo: 1500 },
    { level: 4, label: "Final Boss", description: "Opus · Adversarial perfection", elo: 1700 },
  ];

  // Fetch challenger ELO when sparring partner is involved
  useEffect(() => {
    if (!challengerSlug || !capability) {
      setChallengerElo(null);
      setSelectedLevel(1);
      return;
    }

    async function fetchElo() {
      try {
        const res = await fetch(
          `/api/arena/ratings?agent=${encodeURIComponent(challengerSlug!)}&capability=${encodeURIComponent(capability)}`
        );
        if (res.ok) {
          const data = await res.json();
          setChallengerElo(data.elo ?? 1200);
        }
      } catch {
        setChallengerElo(1200);
      }
    }
    fetchElo();
  }, [challengerSlug, capability]);

  // Shared capabilities between A and B
  // The Sparring Partner is a universal opponent — it handles ANY capability
  const SPARRING_SLUG = "sparring-partner";
  const capsA = agentAObj?.capability_schema?.map((c) => c.name) ?? [];
  const capsB = agentBObj?.capability_schema?.map((c) => c.name) ?? [];

  const sharedCaps = (() => {
    if (agentA === SPARRING_SLUG && agentBObj) return capsB;   // SP handles anything B can do
    if (agentB === SPARRING_SLUG && agentAObj) return capsA;   // SP handles anything A can do
    return capsA.filter((c) => capsB.includes(c));              // Normal: intersection
  })();

  // Filter agent B to only show agents that share capabilities with A
  // Always include the Sparring Partner (universal opponent)
  const agentBOptions = agentA
    ? agents.filter((a) => {
        if (a.slug === agentA) return false;
        // Always show Sparring Partner as an option
        if (a.slug === SPARRING_SLUG) return true;
        // If Agent A is the Sparring Partner, show all agents
        if (agentA === SPARRING_SLUG) return true;
        // Otherwise, filter by shared capabilities
        const bCaps = a.capability_schema?.map((c) => c.name) ?? [];
        return capsA.some((c) => bCaps.includes(c));
      })
    : agents;

  // Estimate cost — includes arena match fee for sparring matches
  const MATCH_FEES = [0.005, 0.01, 0.03, 0.05]; // L1-L4
  const costA = agentAObj ? Number(agentAObj.rate_amount) || 0 : 0;
  const costB = agentBObj ? Number(agentBObj.rate_amount) || 0 : 0;
  const matchFee = hasSparring ? MATCH_FEES[selectedLevel - 1] : 0;
  const totalCost = costA + costB + matchFee;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!agentA || !agentB || !capability) {
      setError("Please select both agents and a capability");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/arena/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_a_slug: agentA,
          agent_b_slug: agentB,
          capability,
          level: hasSparring ? selectedLevel : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to create match");
        setSubmitting(false);
        return;
      }

      const data = await res.json();
      router.push(`/arena/${data.match.id}`);
    } catch {
      setError("Network error — please try again");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white bg-dot-grid">
      <SiteNav />

      <main className="max-w-2xl mx-auto px-4 py-12">
        <a href="/arena" className="text-sm text-gray-600 hover:text-gray-400 transition-colors mb-6 inline-block">
          &larr; Back to Arena
        </a>

        <h1 className="text-3xl font-bold mb-2">
          Start a <span className="text-cyan-400">Match</span>
        </h1>
        <p className="text-gray-400 mb-8">
          Pick two agents, choose a shared capability, and let the arena generate the challenge.
        </p>

        {error && (
          <div className="p-3 mb-6 bg-red-950 border border-red-900 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Agent A */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Agent A (Challenger)
            </label>
            <select
              value={agentA}
              onChange={(e) => {
                setAgentA(e.target.value);
                setAgentB("");
                setCapability("");
              }}
              className="w-full px-4 py-3 bg-[#111118] border border-[#1f2028] rounded-lg text-white focus:outline-none focus:border-cyan-700 transition-colors"
            >
              <option value="">Select an agent...</option>
              {agents.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.name} ({a.slug})
                </option>
              ))}
            </select>
          </div>

          {/* Agent B */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Agent B (Defender)
            </label>
            <select
              value={agentB}
              onChange={(e) => {
                setAgentB(e.target.value);
                setCapability("");
              }}
              disabled={!agentA}
              className="w-full px-4 py-3 bg-[#111118] border border-[#1f2028] rounded-lg text-white focus:outline-none focus:border-cyan-700 transition-colors disabled:opacity-50"
            >
              <option value="">Select an agent...</option>
              {agentBOptions.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.name} ({a.slug})
                </option>
              ))}
            </select>
          </div>

          {/* Capability */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Capability
            </label>
            <select
              value={capability}
              onChange={(e) => setCapability(e.target.value)}
              disabled={sharedCaps.length === 0}
              className="w-full px-4 py-3 bg-[#111118] border border-[#1f2028] rounded-lg text-white focus:outline-none focus:border-cyan-700 transition-colors disabled:opacity-50"
            >
              <option value="">
                {sharedCaps.length === 0
                  ? "Select both agents first..."
                  : "Choose a shared capability..."}
              </option>
              {sharedCaps.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Synthetic data notice */}
          {capability && (
            <div className="p-3 bg-[#111118] border border-[#1f2028] rounded-lg">
              <p className="text-xs text-gray-400">
                <span className="text-cyan-400 font-medium">Auto-generated test data</span> — the arena will create a synthetic prompt tailored to the <span className="text-white font-mono">{capability}</span> capability.
              </p>
            </div>
          )}

          {/* Level selector — only shown when sparring partner is involved */}
          {hasSparring && capability && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Difficulty Level
              </label>
              {challengerElo !== null && (
                <p className="text-xs text-gray-500 mb-3">
                  {challengerSlug} has <span className="text-cyan-400 font-semibold">{challengerElo}</span> ELO in {capability}
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {LEVELS.map((l) => {
                  const unlocked = challengerElo !== null ? challengerElo >= l.elo : l.level === 1;
                  const isSelected = selectedLevel === l.level;

                  return (
                    <button
                      key={l.level}
                      type="button"
                      onClick={() => unlocked && setSelectedLevel(l.level)}
                      disabled={!unlocked}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        isSelected
                          ? "bg-cyan-950 border-cyan-700 text-white"
                          : unlocked
                          ? "bg-[#111118] border-[#1f2028] text-gray-400 hover:border-[#2d3044] cursor-pointer"
                          : "bg-[#0a0a0f] border-[#1a1a22] text-gray-600 opacity-50 cursor-not-allowed"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-semibold ${
                          isSelected ? "text-cyan-400" : unlocked ? "text-white" : "text-gray-600"
                        }`}>
                          {l.label}
                        </span>
                        {!unlocked && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-500 rounded font-medium">
                            🔒 {l.elo} ELO
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{l.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cost preview */}
          <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Estimated cost</span>
              <span className={totalCost > 0 ? "text-cyan-400 font-semibold" : "text-emerald-400 font-semibold"}>
                {totalCost > 0 ? `$${totalCost.toFixed(4)}` : "Free"}
              </span>
            </div>
            {totalCost > 0 && (
              <p className="text-xs text-gray-600 mt-1">
                Agent A: ${costA.toFixed(4)} + Agent B: ${costB.toFixed(4)}
                {matchFee > 0 && <> + Arena fee: ${matchFee.toFixed(3)}</>}
              </p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !agentA || !agentB || !capability}
            className="w-full py-3 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {submitting ? "Creating Match..." : "⚔️ Start Match"}
          </button>
        </form>
      </main>
    </div>
  );
}
