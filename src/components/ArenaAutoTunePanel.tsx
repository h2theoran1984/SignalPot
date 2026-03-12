"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface AgentOption {
  id: string;
  name: string;
  slug: string;
}

interface IterationResult {
  iteration: number;
  baseline_elo: number;
  baseline_record: { wins: number; losses: number; ties: number };
  candidate_elo: number | null;
  candidate_record: { wins: number; losses: number; ties: number } | null;
  elo_delta: number | null;
  kept: boolean;
  prompt_version: number;
  weakness_summary: string;
  stopped_reason: string;
}

interface AutoTuneResult {
  agent: string;
  capability: string;
  level: number;
  iterations: IterationResult[];
  final_elo: number;
  total_elo_gain: number;
  active_version: number;
}

const STOPPED_COLORS: Record<string, string> = {
  improved: "bg-emerald-950 text-emerald-400 border-emerald-900",
  regressed: "bg-red-950 text-red-400 border-red-900",
  perfect_score: "bg-yellow-950 text-yellow-400 border-yellow-900",
  grind_error: "bg-red-950 text-red-400 border-red-900",
  candidate_grind_error: "bg-red-950 text-red-400 border-red-900",
  prompt_generation_error: "bg-orange-950 text-orange-400 border-orange-900",
};

export function ArenaAutoTunePanel() {
  // Agent list
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);

  // Form state
  const [selectedSlug, setSelectedSlug] = useState("");
  const [capability, setCapability] = useState("");
  const [level, setLevel] = useState(1);
  const [roundsPerPhase, setRoundsPerPhase] = useState(10);
  const [maxIterations, setMaxIterations] = useState(3);

  // UI state
  const [isOpen, setIsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutoTuneResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            }))
          );
        }
      } catch {
        // Silently fail — user can still type slug
      } finally {
        setAgentsLoading(false);
      }
    }

    loadAgents();
  }, [isOpen, agents.length]);

  async function handleAutoTune() {
    if (!selectedSlug.trim() || !capability.trim()) return;

    setRunning(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch("/api/arena/autotune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_slug: selectedSlug.trim(),
          capability: capability.trim(),
          level,
          rounds_per_phase: roundsPerPhase,
          max_iterations: maxIterations,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      const data: AutoTuneResult = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRunning(false);
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
        <span className="text-purple-400">AutoTune</span>
        <span className="text-xs text-gray-600 font-normal ml-2">
          Automatically optimize prompts via grind → analyze → improve loop
        </span>
      </button>

      {isOpen && (
        <div className="p-6 bg-[#111118] border border-[#1f2028] rounded-lg">
          {/* Form */}
          {!running && !result && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Agent dropdown */}
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-300">Agent</label>
                  <select
                    value={selectedSlug}
                    onChange={(e) => setSelectedSlug(e.target.value)}
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

                {/* Capability input */}
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-300">Capability</label>
                  <input
                    type="text"
                    placeholder="e.g. meeting-summary@v1"
                    value={capability}
                    onChange={(e) => setCapability(e.target.value)}
                    className="w-full px-4 py-2.5 bg-[#111118] border border-[#1f2028] rounded-lg text-white placeholder-gray-600 transition-colors focus:outline-none focus:border-cyan-700"
                  />
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
              </div>

              {/* Rounds per phase + Max iterations */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-300">
                    Rounds per Phase: <span className="text-purple-400">{roundsPerPhase}</span>
                  </label>
                  <input
                    type="range"
                    min={3}
                    max={30}
                    value={roundsPerPhase}
                    onChange={(e) => setRoundsPerPhase(parseInt(e.target.value))}
                    className="w-full accent-purple-400"
                  />
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>3</span>
                    <span>15</span>
                    <span>30</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-300">
                    Max Iterations: <span className="text-purple-400">{maxIterations}</span>
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={maxIterations}
                    onChange={(e) => setMaxIterations(parseInt(e.target.value))}
                    className="w-full accent-purple-400"
                  />
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>1</span>
                    <span>3</span>
                    <span>5</span>
                  </div>
                </div>
              </div>

              {/* How it works */}
              <div className="p-3 bg-[#0a0a0f] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500">
                  Each iteration: grind baseline → analyze weaknesses → generate improved prompt → grind candidate → compare ELO.
                  Keeps the prompt if ELO improves, reverts if it regresses.
                </p>
              </div>

              {error && (
                <div className="p-3 bg-red-950/50 border border-red-900 rounded-lg text-sm text-red-400">
                  {error}
                </div>
              )}

              <Button
                variant="brand"
                size="lg"
                onClick={handleAutoTune}
                disabled={!selectedSlug.trim() || !capability.trim()}
                className="w-full"
              >
                Start AutoTune
              </Button>
            </div>
          )}

          {/* Running state */}
          {running && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-10 h-10 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-purple-400 font-medium">AutoTuning...</p>
              <p className="text-sm text-gray-500">
                Running up to {maxIterations} iteration{maxIterations !== 1 ? "s" : ""} × {roundsPerPhase} rounds each — this will take a while
              </p>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-6">
              {/* Summary headline */}
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-1">
                  {result.agent} / {result.capability}
                </p>
                <p className="text-3xl font-bold tracking-wide">
                  {result.total_elo_gain > 0 ? (
                    <span className="text-emerald-400">+{result.total_elo_gain}</span>
                  ) : result.total_elo_gain < 0 ? (
                    <span className="text-red-400">{result.total_elo_gain}</span>
                  ) : (
                    <span className="text-gray-400">±0</span>
                  )}
                  <span className="text-gray-600 text-lg ml-2">ELO</span>
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Final ELO: <span className="text-white font-medium">{result.final_elo}</span>
                  {" · "}Active version: <span className="text-white font-medium">v{result.active_version}</span>
                </p>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-3 bg-[#0a0a0f] rounded-lg border border-[#1f2028]">
                  <p className="text-xs text-gray-500 mb-1">Iterations</p>
                  <p className="text-lg font-bold text-purple-400">{result.iterations.length}</p>
                </div>
                <div className="p-3 bg-[#0a0a0f] rounded-lg border border-[#1f2028]">
                  <p className="text-xs text-gray-500 mb-1">Level</p>
                  <p className="text-lg font-bold text-white">
                    {result.level === 4 ? "Boss" : `L${result.level}`}
                  </p>
                </div>
                <div className="p-3 bg-[#0a0a0f] rounded-lg border border-[#1f2028]">
                  <p className="text-xs text-gray-500 mb-1">ELO Gain</p>
                  <p className={`text-lg font-bold ${result.total_elo_gain > 0 ? "text-emerald-400" : result.total_elo_gain < 0 ? "text-red-400" : "text-gray-400"}`}>
                    {result.total_elo_gain > 0 ? "+" : ""}{result.total_elo_gain}
                  </p>
                </div>
              </div>

              {/* Iteration details */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-400">Iterations</h3>
                {result.iterations.map((iter) => (
                  <div
                    key={iter.iteration}
                    className="p-4 bg-[#0a0a0f] rounded-lg border border-[#1f2028]"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-600">#{iter.iteration}</span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-xs rounded border font-bold ${
                            iter.kept
                              ? "bg-emerald-950 text-emerald-400 border-emerald-900"
                              : "bg-red-950 text-red-400 border-red-900"
                          }`}
                        >
                          {iter.kept ? "KEPT" : "REVERTED"}
                        </span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-xs rounded border font-medium ${
                            STOPPED_COLORS[iter.stopped_reason] ??
                            "bg-gray-900 text-gray-400 border-gray-800"
                          }`}
                        >
                          {iter.stopped_reason}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">v{iter.prompt_version}</span>
                    </div>

                    {/* Records */}
                    <div className="grid grid-cols-2 gap-4 mb-2">
                      <div>
                        <p className="text-xs text-gray-600 mb-0.5">Baseline</p>
                        <p className="text-sm">
                          <span className="text-white font-medium">{iter.baseline_elo}</span>
                          <span className="text-gray-600 mx-1">·</span>
                          <span className="text-emerald-400">{iter.baseline_record.wins}W</span>
                          <span className="text-gray-600">-</span>
                          <span className="text-red-400">{iter.baseline_record.losses}L</span>
                          <span className="text-gray-600">-</span>
                          <span className="text-yellow-400">{iter.baseline_record.ties}T</span>
                        </p>
                      </div>
                      {iter.candidate_elo !== null && iter.candidate_record && (
                        <div>
                          <p className="text-xs text-gray-600 mb-0.5">Candidate</p>
                          <p className="text-sm">
                            <span className="text-white font-medium">{iter.candidate_elo}</span>
                            <span className="text-gray-600 mx-1">·</span>
                            <span className="text-emerald-400">{iter.candidate_record.wins}W</span>
                            <span className="text-gray-600">-</span>
                            <span className="text-red-400">{iter.candidate_record.losses}L</span>
                            <span className="text-gray-600">-</span>
                            <span className="text-yellow-400">{iter.candidate_record.ties}T</span>
                          </p>
                        </div>
                      )}
                    </div>

                    {/* ELO delta */}
                    {iter.elo_delta !== null && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-gray-600">ELO Delta:</span>
                        <span
                          className={`text-sm font-bold ${
                            iter.elo_delta > 0
                              ? "text-emerald-400"
                              : iter.elo_delta < 0
                                ? "text-red-400"
                                : "text-gray-400"
                          }`}
                        >
                          {iter.elo_delta > 0 ? "+" : ""}{iter.elo_delta}
                        </span>
                      </div>
                    )}

                    {/* Weakness summary */}
                    <p className="text-xs text-gray-500 leading-relaxed">
                      {iter.weakness_summary}
                    </p>
                  </div>
                ))}
              </div>

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
                Run Another AutoTune
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
