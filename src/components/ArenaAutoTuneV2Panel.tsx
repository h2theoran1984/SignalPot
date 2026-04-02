"use client";

import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";

// ============================================================
// Types
// ============================================================

interface AgentOption {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  capability_schema: { name: string; description?: string }[];
}

interface AxisScores {
  accuracy: number;
  speed: number;
  cost: number;
  reliability: number;
  composite: number;
}

interface SoloIterationResult {
  iteration: number;
  scores: AxisScores;
  prompt_version: number;
  weakness_summary: string;
  stopped_reason: string;
  kept: boolean;
}

interface AutoTuneV2Result {
  agent: string;
  capability: string;
  level: number;
  training_goal: string | null;
  factor_weights: { accuracy: number; speed: number; cost: number; reliability: number };
  iterations: SoloIterationResult[];
  start_dot: AxisScores;
  end_dot: AxisScores;
  target_dot: { accuracy: number; speed: number; cost: number; reliability: number };
  improvement: AxisScores;
  challenges_used: number;
}

const STOPPED_COLORS: Record<string, string> = {
  baseline: "bg-blue-950 text-blue-400 border-blue-900",
  improved: "bg-emerald-950 text-emerald-400 border-emerald-900",
  regressed: "bg-red-950 text-red-400 border-red-900",
  near_perfect: "bg-yellow-950 text-yellow-400 border-yellow-900",
  prompt_generation_error: "bg-orange-950 text-orange-400 border-orange-900",
};

const AXES = ["accuracy", "speed", "cost", "reliability"] as const;
type Axis = (typeof AXES)[number];

// ============================================================
// 4-Axis Radar Chart (SVG)
// ============================================================

function RadarChart({
  startDot,
  endDot,
  targetWeights,
}: {
  startDot: Record<Axis, number>;
  endDot: Record<Axis, number> | null;
  targetWeights: Record<Axis, number>;
}) {
  const size = 280;
  const center = size / 2;
  const radius = 110;
  const levels = 5; // Concentric rings

  // Axis positions (top, right, bottom, left)
  const axisAngles: Record<Axis, number> = {
    accuracy: -Math.PI / 2,   // top
    speed: 0,                  // right
    reliability: Math.PI / 2,  // bottom
    cost: Math.PI,             // left
  };

  const getPoint = (axis: Axis, value: number): { x: number; y: number } => {
    const angle = axisAngles[axis];
    return {
      x: center + Math.cos(angle) * radius * value,
      y: center + Math.sin(angle) * radius * value,
    };
  };

  const getPolygonPoints = (values: Record<Axis, number>): string => {
    return AXES.map((axis) => {
      const pt = getPoint(axis, values[axis]);
      return `${pt.x},${pt.y}`;
    }).join(" ");
  };

  const labelOffsets: Record<Axis, { dx: number; dy: number }> = {
    accuracy: { dx: 0, dy: -14 },
    speed: { dx: 14, dy: 0 },
    reliability: { dx: 0, dy: 18 },
    cost: { dx: -14, dy: 0 },
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[300px] mx-auto">
      {/* Concentric grid rings */}
      {Array.from({ length: levels }, (_, i) => {
        const r = (radius * (i + 1)) / levels;
        return (
          <polygon
            key={i}
            points={AXES.map((axis) => {
              const angle = axisAngles[axis];
              return `${center + Math.cos(angle) * r},${center + Math.sin(angle) * r}`;
            }).join(" ")}
            fill="none"
            stroke="#1f2028"
            strokeWidth={0.5}
          />
        );
      })}

      {/* Axis lines */}
      {AXES.map((axis) => {
        const end = getPoint(axis, 1);
        return (
          <line
            key={axis}
            x1={center}
            y1={center}
            x2={end.x}
            y2={end.y}
            stroke="#2a2a35"
            strokeWidth={0.5}
          />
        );
      })}

      {/* Target weights (dashed outline) */}
      <polygon
        points={getPolygonPoints(targetWeights)}
        fill="none"
        stroke="#22d3ee"
        strokeWidth={1.5}
        strokeDasharray="4 3"
        opacity={0.5}
      />

      {/* Start dot polygon */}
      <polygon
        points={getPolygonPoints(startDot)}
        fill="rgba(168, 85, 247, 0.15)"
        stroke="#a855f7"
        strokeWidth={1.5}
      />

      {/* End dot polygon (if different from start) */}
      {endDot && (
        <polygon
          points={getPolygonPoints(endDot)}
          fill="rgba(52, 211, 153, 0.15)"
          stroke="#34d399"
          strokeWidth={1.5}
        />
      )}

      {/* Axis labels */}
      {AXES.map((axis) => {
        const pt = getPoint(axis, 1);
        const offset = labelOffsets[axis];
        return (
          <text
            key={axis}
            x={pt.x + offset.dx}
            y={pt.y + offset.dy}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-gray-400 text-[11px] font-medium"
          >
            {axis.charAt(0).toUpperCase() + axis.slice(1)}
          </text>
        );
      })}

      {/* Data points for start */}
      {AXES.map((axis) => {
        const pt = getPoint(axis, startDot[axis]);
        return <circle key={`start-${axis}`} cx={pt.x} cy={pt.y} r={3} fill="#a855f7" />;
      })}

      {/* Data points for end */}
      {endDot &&
        AXES.map((axis) => {
          const pt = getPoint(axis, endDot[axis]);
          return <circle key={`end-${axis}`} cx={pt.x} cy={pt.y} r={3} fill="#34d399" />;
        })}
    </svg>
  );
}

// ============================================================
// Factor Weight Slider
// ============================================================

function FactorSlider({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400 w-20">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(parseInt(e.target.value) / 100)}
        className={`flex-1 accent-${color}-400`}
        style={{ accentColor: color === "cyan" ? "#22d3ee" : color === "green" ? "#34d399" : color === "yellow" ? "#facc15" : "#a855f7" }}
      />
      <span className="text-xs text-white w-10 text-right font-mono">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

// ============================================================
// Main Panel
// ============================================================

export function ArenaAutoTuneV2Panel() {
  // Agent list
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);

  // Form state
  const [selectedSlug, setSelectedSlug] = useState("");
  const [capability, setCapability] = useState("");
  const [level, setLevel] = useState(1);
  const [roundsPerPhase, setRoundsPerPhase] = useState(10);
  const [maxIterations, setMaxIterations] = useState(3);
  const [trainingGoal, setTrainingGoal] = useState("");

  // Factor weights
  const [weights, setWeights] = useState<Record<Axis, number>>({
    accuracy: 0.4,
    speed: 0.2,
    cost: 0.2,
    reliability: 0.2,
  });

  // UI state
  const [isOpen, setIsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutoTuneV2Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derived
  const selectedAgent = agents.find((a) => a.slug === selectedSlug);
  const capabilities = selectedAgent?.capability_schema ?? [];

  // Pre-fill training goal from agent description when agent changes
  useEffect(() => {
    if (selectedAgent?.description) {
      setTrainingGoal(selectedAgent.description);
    }
  }, [selectedAgent?.description]);

  // Fetch agents when panel opens
  // Shows all active agents — backend rejects agents without prompt versions
  // (only SignalPot-managed agents have prompt versions and can run the full autotune loop)
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
              description: a.description ?? null,
              capability_schema: a.capability_schema ?? [],
            })),
          );
        }
      } catch {
        // Silently fail
      } finally {
        setAgentsLoading(false);
      }
    }

    loadAgents();
  }, [isOpen, agents.length]);

  function updateWeight(axis: Axis, value: number) {
    setWeights((prev) => {
      const updated = { ...prev, [axis]: value };
      // Normalize so they sum to 1
      const sum = Object.values(updated).reduce((s, v) => s + v, 0);
      if (sum > 0) {
        for (const key of AXES) {
          updated[key] = updated[key] / sum;
        }
      }
      return updated;
    });
  }

  async function handleAutoTune() {
    if (!selectedSlug.trim() || !capability.trim()) return;

    setRunning(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch("/api/arena/autotune-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_slug: selectedSlug.trim(),
          capability: capability.trim(),
          level,
          rounds_per_phase: roundsPerPhase,
          max_iterations: maxIterations,
          training_goal: trainingGoal.trim() || undefined,
          factor_weights: weights,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      const data: AutoTuneV2Result = await res.json();
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
        <span className="text-cyan-400">AutoTune v2</span>
        <span className="text-xs text-gray-600 font-normal ml-2">
          Solo training loop — constraint-based scoring on 4 axes, no opponent needed
        </span>
      </button>

      {isOpen && (
        <div className="p-6 bg-[#111118] border border-[#1f2028] rounded-lg">
          {/* Form */}
          {!running && !result && (
            <div className="space-y-5">
              {/* Agent + Capability row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-300">Agent</label>
                  <select
                    value={selectedSlug}
                    onChange={(e) => {
                      setSelectedSlug(e.target.value);
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
                      <option key={agent.id} value={agent.slug} className="bg-[#0a0a0f] text-white">
                        {agent.name} ({agent.slug})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-300">Capability</label>
                  <select
                    value={capability}
                    onChange={(e) => setCapability(e.target.value)}
                    disabled={!selectedSlug || capabilities.length === 0}
                    className="w-full px-4 py-2.5 bg-[#111118] border border-[#1f2028] rounded-lg text-white transition-colors focus:outline-none focus:border-cyan-700 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 12px center",
                    }}
                  >
                    <option value="" className="bg-[#0a0a0f] text-gray-500">
                      {!selectedSlug ? "Select an agent first" : capabilities.length === 0 ? "No capabilities" : "Select a capability"}
                    </option>
                    {capabilities.map((cap) => (
                      <option key={cap.name} value={cap.name} className="bg-[#0a0a0f] text-white">
                        {cap.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Training Goal */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-300">
                  Training Goal
                  <span className="text-xs text-gray-600 font-normal ml-2">
                    What should this agent optimize for? (pre-filled from agent description)
                  </span>
                </label>
                <textarea
                  value={trainingGoal}
                  onChange={(e) => setTrainingGoal(e.target.value)}
                  placeholder="e.g., Nail compliance extraction from messy PDFs — accuracy is everything, speed doesn't matter"
                  rows={2}
                  className="w-full px-4 py-2.5 bg-[#111118] border border-[#1f2028] rounded-lg text-white transition-colors focus:outline-none focus:border-cyan-700 resize-none placeholder-gray-600"
                />
              </div>

              {/* Factor Weights */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-300">
                  Optimization Target
                  <span className="text-xs text-gray-600 font-normal ml-2">
                    Set your priorities — what matters most?
                  </span>
                </label>
                <div className="p-4 bg-[#0a0a0f] border border-[#1f2028] rounded-lg space-y-3">
                  <FactorSlider label="Accuracy" value={weights.accuracy} onChange={(v) => updateWeight("accuracy", v)} color="cyan" />
                  <FactorSlider label="Speed" value={weights.speed} onChange={(v) => updateWeight("speed", v)} color="green" />
                  <FactorSlider label="Cost" value={weights.cost} onChange={(v) => updateWeight("cost", v)} color="yellow" />
                  <FactorSlider label="Reliability" value={weights.reliability} onChange={(v) => updateWeight("reliability", v)} color="purple" />
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
                    Challenges per Iteration: <span className="text-cyan-400">{roundsPerPhase}</span>
                  </label>
                  <input
                    type="range"
                    min={3}
                    max={30}
                    value={roundsPerPhase}
                    onChange={(e) => setRoundsPerPhase(parseInt(e.target.value))}
                    className="w-full accent-cyan-400"
                  />
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>3</span>
                    <span>15</span>
                    <span>30</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-300">
                    Max Iterations: <span className="text-cyan-400">{maxIterations}</span>
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={maxIterations}
                    onChange={(e) => setMaxIterations(parseInt(e.target.value))}
                    className="w-full accent-cyan-400"
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
                  Solo training — no opponent needed. Generates constraint-based challenges, scores your agent deterministically,
                  identifies weaknesses, improves the prompt, and re-scores. Keeps improvements, reverts regressions.
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
                Start AutoTune v2
              </Button>
            </div>
          )}

          {/* Running state */}
          {running && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-cyan-400 font-medium">AutoTuning (Solo)...</p>
              <p className="text-sm text-gray-500">
                Generating challenges → scoring → improving — up to {maxIterations} iteration{maxIterations !== 1 ? "s" : ""}
              </p>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-6">
              {/* Radar Chart */}
              <div className="flex flex-col items-center">
                <RadarChart
                  startDot={result.start_dot}
                  endDot={result.iterations.length > 1 ? result.end_dot : null}
                  targetWeights={result.factor_weights}
                />
                <div className="flex items-center gap-6 mt-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-0.5 bg-purple-500" />
                    <span className="text-gray-500">Start (Iter 1)</span>
                  </div>
                  {result.iterations.length > 1 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-0.5 bg-emerald-400" />
                      <span className="text-gray-500">End (Iter {result.iterations.length})</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-0.5 border-t border-dashed border-cyan-400" />
                    <span className="text-gray-500">Target</span>
                  </div>
                </div>
              </div>

              {/* Summary headline */}
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-1">
                  {result.agent} / {result.capability}
                </p>
                <p className="text-3xl font-bold tracking-wide">
                  {result.improvement.composite > 0.005 ? (
                    <span className="text-emerald-400">+{(result.improvement.composite * 100).toFixed(1)}%</span>
                  ) : result.improvement.composite < -0.005 ? (
                    <span className="text-red-400">{(result.improvement.composite * 100).toFixed(1)}%</span>
                  ) : (
                    <span className="text-gray-400">No change</span>
                  )}
                  <span className="text-gray-600 text-lg ml-2">composite</span>
                </p>
                {result.training_goal && (
                  <p className="text-xs text-gray-600 mt-1 italic">Goal: {result.training_goal}</p>
                )}
              </div>

              {/* 4-axis scores comparison */}
              <div className="grid grid-cols-4 gap-3 text-center">
                {AXES.map((axis) => (
                  <div key={axis} className="p-3 bg-[#0a0a0f] rounded-lg border border-[#1f2028]">
                    <p className="text-xs text-gray-500 mb-1 capitalize">{axis}</p>
                    <p className="text-lg font-bold text-white">
                      {(result.end_dot[axis] * 100).toFixed(0)}
                      <span className="text-xs text-gray-500">%</span>
                    </p>
                    {result.improvement[axis] !== 0 && (
                      <p className={`text-xs font-medium ${result.improvement[axis] > 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {result.improvement[axis] > 0 ? "+" : ""}
                        {(result.improvement[axis] * 100).toFixed(1)}%
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-3 bg-[#0a0a0f] rounded-lg border border-[#1f2028]">
                  <p className="text-xs text-gray-500 mb-1">Iterations</p>
                  <p className="text-lg font-bold text-cyan-400">{result.iterations.length}</p>
                </div>
                <div className="p-3 bg-[#0a0a0f] rounded-lg border border-[#1f2028]">
                  <p className="text-xs text-gray-500 mb-1">Challenges</p>
                  <p className="text-lg font-bold text-white">{result.challenges_used}</p>
                </div>
                <div className="p-3 bg-[#0a0a0f] rounded-lg border border-[#1f2028]">
                  <p className="text-xs text-gray-500 mb-1">Level</p>
                  <p className="text-lg font-bold text-white">
                    {result.level === 4 ? "Boss" : `L${result.level}`}
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
                            STOPPED_COLORS[iter.stopped_reason] ?? "bg-gray-900 text-gray-400 border-gray-800"
                          }`}
                        >
                          {iter.stopped_reason}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">v{iter.prompt_version}</span>
                    </div>

                    {/* 4-axis mini scores */}
                    <div className="flex items-center gap-4 mb-2">
                      {AXES.map((axis) => (
                        <div key={axis} className="text-xs">
                          <span className="text-gray-600 capitalize">{axis}: </span>
                          <span className="text-white font-mono">{(iter.scores[axis] * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                      <div className="text-xs ml-auto">
                        <span className="text-gray-600">Composite: </span>
                        <span className="text-cyan-400 font-mono font-bold">
                          {(iter.scores.composite * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>

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
