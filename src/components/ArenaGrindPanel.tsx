"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface AgentOption {
  id: string;
  name: string;
  slug: string;
  capability_schema: { name: string }[];
}

interface GrindRound {
  round: number;
  winner: "win" | "loss" | "tie";
  elo_change: number;
  cost_usd: number;
  match_id?: string;
}

interface GrindResult {
  agent: string;
  capability: string;
  level: number;
  rounds_played: number;
  record: { wins: number; losses: number; ties: number };
  total_spent_usd: number;
  credit_limit: number;
  stopped_reason: string;
  current_elo: number;
  rounds: GrindRound[];
}

const STOP_REASON_COLORS: Record<string, string> = {
  loss: "bg-red-950 text-red-400 border-red-900",
  credit_limit: "bg-yellow-950 text-yellow-400 border-yellow-900",
  max_rounds: "bg-emerald-950 text-emerald-400 border-emerald-900",
  completed: "bg-emerald-950 text-emerald-400 border-emerald-900",
  error: "bg-red-950 text-red-400 border-red-900",
};

export function ArenaGrindPanel() {
  // Agent list
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);

  // Form state
  const [agentSlug, setAgentSlug] = useState("");
  const [capability, setCapability] = useState("");
  const [level, setLevel] = useState(1);
  const [maxRounds, setMaxRounds] = useState(20);
  const [creditLimit, setCreditLimit] = useState("");
  const [stopOnLoss, setStopOnLoss] = useState(true);

  // UI state
  const [isOpen, setIsOpen] = useState(false);
  const [grinding, setGrinding] = useState(false);
  const [result, setResult] = useState<GrindResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roundsExpanded, setRoundsExpanded] = useState(false);

  // Derived: capabilities for selected agent
  const selectedAgent = agents.find((a) => a.slug === agentSlug);
  const capabilities = selectedAgent?.capability_schema ?? [];

  // Fetch agents when panel opens
  useEffect(() => {
    if (!isOpen || agents.length > 0) return;

    async function loadAgents() {
      setAgentsLoading(true);
      try {
        const res = await fetch("/api/agents?limit=100&status=active");
        if (res.ok) {
          const data = await res.json();
          setAgents(
            (data.agents ?? []).map((a: AgentOption) => ({
              id: a.id,
              name: a.name,
              slug: a.slug,
              capability_schema: a.capability_schema ?? [],
            }))
          );
        }
      } catch {
        // Silently fail — user can still type
      } finally {
        setAgentsLoading(false);
      }
    }

    loadAgents();
  }, [isOpen, agents.length]);

  async function handleGrind() {
    if (!agentSlug.trim() || !capability.trim()) return;

    setGrinding(true);
    setResult(null);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        agent_slug: agentSlug.trim(),
        capability: capability.trim(),
        level,
        max_rounds: maxRounds,
        stop_on_loss: stopOnLoss,
      };
      if (creditLimit.trim()) {
        body.credit_limit = parseFloat(creditLimit);
      }

      const res = await fetch("/api/arena/grind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      const data: GrindResult = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setGrinding(false);
    }
  }

  return (
    <section className="mb-12">
      {/* Collapsible header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-lg font-semibold mb-4 group cursor-pointer w-full text-left"
      >
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-orange-400">Grind Mode</span>
        <span className="text-xs text-gray-600 font-normal ml-2">
          Auto-run multiple ranked matches
        </span>
      </button>

      {isOpen && (
        <div className="p-6 bg-[#111118] border border-[#1f2028] rounded-lg">
          {/* Form */}
          {!grinding && !result && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Agent dropdown */}
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-300">Agent</label>
                  <select
                    value={agentSlug}
                    onChange={(e) => {
                      setAgentSlug(e.target.value);
                      setCapability("");
                    }}
                    className="w-full px-4 py-2.5 bg-[#111118] border border-[#1f2028] rounded-lg text-white transition-colors focus:outline-none focus:border-cyan-700 appearance-none cursor-pointer"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 12px center",
                    }}
                  >
                    <option value="" className="bg-[#0a0a0f] text-gray-500">
                      {agentsLoading ? "Loading agents..." : "Select an agent"}
                    </option>
                    {agents.map((agent) => (
                      <option
                        key={agent.id}
                        value={agent.slug}
                        className="bg-[#0a0a0f] text-white"
                      >
                        {agent.name} ({agent.slug})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Capability dropdown */}
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-300">Capability</label>
                  <select
                    value={capability}
                    onChange={(e) => setCapability(e.target.value)}
                    disabled={!agentSlug || capabilities.length === 0}
                    className="w-full px-4 py-2.5 bg-[#111118] border border-[#1f2028] rounded-lg text-white transition-colors focus:outline-none focus:border-cyan-700 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 12px center",
                    }}
                  >
                    <option value="" className="bg-[#0a0a0f] text-gray-500">
                      {!agentSlug ? "Select an agent first" : capabilities.length === 0 ? "No capabilities" : "Select a capability"}
                    </option>
                    {capabilities.map((cap) => (
                      <option
                        key={cap.name}
                        value={cap.name}
                        className="bg-[#0a0a0f] text-white"
                      >
                        {cap.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Level selector */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-300">Level</label>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4].map((l) => (
                    <button
                      key={l}
                      onClick={() => setLevel(l)}
                      className={`px-4 py-2 text-sm rounded-lg border font-medium transition-colors cursor-pointer ${
                        level === l
                          ? l === 4
                            ? "bg-red-950/70 text-yellow-300 border-yellow-700/50"
                            : l === 3
                              ? "bg-purple-900/50 text-purple-400 border-purple-700/50"
                              : l === 2
                                ? "bg-blue-900/50 text-blue-400 border-blue-700/50"
                                : "bg-cyan-900/30 text-cyan-400 border-cyan-700/50"
                          : "bg-transparent text-gray-500 border-[#1f2028] hover:border-gray-600"
                      }`}
                    >
                      {l === 4 ? "Final Boss" : `Level ${l}`}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  Arena fee: ${[0.005, 0.01, 0.03, 0.05][level - 1]}/match
                </p>
              </div>

              {/* Max rounds slider */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-300">
                  Max Rounds: <span className="text-cyan-400">{maxRounds}</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={maxRounds}
                  onChange={(e) => setMaxRounds(parseInt(e.target.value))}
                  className="w-full accent-cyan-400"
                />
                <div className="flex justify-between text-xs text-gray-600">
                  <span>1</span>
                  <span>25</span>
                  <span>50</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Credit Limit (USD)"
                  placeholder="e.g. 5.00 (optional)"
                  type="number"
                  step="0.01"
                  min="0"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                  hint="Leave blank for no limit"
                />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-300">Options</label>
                  <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stopOnLoss}
                      onChange={(e) => setStopOnLoss(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-600 bg-[#0a0a0f] accent-cyan-400"
                    />
                    <span className="text-sm text-gray-300">Stop on first loss</span>
                  </label>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-950/50 border border-red-900 rounded-lg text-sm text-red-400">
                  {error}
                </div>
              )}

              <Button
                variant="brand"
                size="lg"
                onClick={handleGrind}
                disabled={!agentSlug.trim() || !capability.trim()}
                className="w-full"
              >
                Start Grinding
              </Button>
            </div>
          )}

          {/* Grinding state */}
          {grinding && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-cyan-400 font-medium">Grinding...</p>
              <p className="text-sm text-gray-500">
                Running up to {maxRounds} rounds — this may take a few minutes
              </p>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-6">
              {/* Record headline */}
              <div className="text-center">
                <p className="text-3xl font-bold tracking-wide">
                  <span className="text-emerald-400">{result.record.wins}W</span>
                  <span className="text-gray-600 mx-2">-</span>
                  <span className="text-red-400">{result.record.losses}L</span>
                  <span className="text-gray-600 mx-2">-</span>
                  <span className="text-yellow-400">{result.record.ties}T</span>
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  {result.rounds_played} round{result.rounds_played !== 1 ? "s" : ""} played
                </p>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-3 bg-[#0a0a0f] rounded-lg border border-[#1f2028]">
                  <p className="text-xs text-gray-500 mb-1">ELO</p>
                  <p className="text-lg font-bold text-cyan-400">{result.current_elo}</p>
                </div>
                <div className="p-3 bg-[#0a0a0f] rounded-lg border border-[#1f2028]">
                  <p className="text-xs text-gray-500 mb-1">Spent</p>
                  <p className="text-lg font-bold text-white">
                    ${result.total_spent_usd.toFixed(2)}
                  </p>
                </div>
                <div className="p-3 bg-[#0a0a0f] rounded-lg border border-[#1f2028]">
                  <p className="text-xs text-gray-500 mb-1">Stopped</p>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-xs rounded border font-medium ${
                      STOP_REASON_COLORS[result.stopped_reason] ??
                      "bg-gray-900 text-gray-400 border-gray-800"
                    }`}
                  >
                    {result.stopped_reason}
                  </span>
                </div>
              </div>

              {/* Per-round results */}
              {result.rounds && result.rounds.length > 0 && (
                <div>
                  <button
                    onClick={() => setRoundsExpanded(!roundsExpanded)}
                    className="flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-white transition-colors cursor-pointer"
                  >
                    <svg
                      className={`w-3 h-3 transition-transform ${roundsExpanded ? "rotate-90" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    Round Details ({result.rounds.length})
                  </button>

                  {roundsExpanded && (
                    <div className="mt-3 space-y-1">
                      {result.rounds.map((round) => (
                        <div
                          key={round.round}
                          className="flex items-center justify-between px-3 py-2 bg-[#0a0a0f] rounded border border-[#1f2028] text-sm"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-gray-600 text-xs w-6">#{round.round}</span>
                            <span
                              className={`font-bold text-xs w-5 ${
                                round.winner === "win"
                                  ? "text-emerald-400"
                                  : round.winner === "loss"
                                    ? "text-red-400"
                                    : "text-yellow-400"
                              }`}
                            >
                              {round.winner === "win" ? "W" : round.winner === "loss" ? "L" : "T"}
                            </span>
                            <span
                              className={`text-xs font-medium ${
                                round.elo_change > 0
                                  ? "text-emerald-400"
                                  : round.elo_change < 0
                                    ? "text-red-400"
                                    : "text-gray-500"
                              }`}
                            >
                              {round.elo_change > 0 ? "+" : ""}
                              {round.elo_change}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-500">
                              ${round.cost_usd.toFixed(3)}
                            </span>
                            {round.match_id && (
                              <a
                                href={`/arena/${round.match_id}`}
                                className="text-xs text-cyan-400/70 hover:text-cyan-400 transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                View
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Reset button */}
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  setResult(null);
                  setError(null);
                }}
                className="w-full"
              >
                Run Another Grind
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
