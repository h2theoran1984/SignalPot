"use client";

import { useEffect, useState } from "react";

interface AxisScores {
  accuracy: number;
  speed: number;
  cost: number;
  reliability: number;
  weissman_score: number;
}

interface MiddleOutRun {
  id: string;
  capability: string;
  level: number;
  training_goal: string | null;
  factor_weights: { accuracy: number; speed: number; cost: number; reliability: number };
  start_dot: AxisScores;
  end_dot: AxisScores;
  improvement: AxisScores;
  weissman_start: number;
  weissman_end: number;
  challenges_used: number;
  iterations: Array<{ iteration: number; scores: AxisScores; stopped_reason: string; kept: boolean }>;
  created_at: string;
}

const AXES = ["accuracy", "speed", "cost", "reliability"] as const;

export function MiddleOutHistory({ agentSlug }: { agentSlug: string }) {
  const [runs, setRuns] = useState<MiddleOutRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/arena/middle-out/history?agent=${encodeURIComponent(agentSlug)}&limit=10`);
        if (res.ok) {
          const data = await res.json();
          setRuns(data.runs ?? []);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [agentSlug]);

  if (loading) {
    return (
      <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg animate-pulse h-20" />
    );
  }

  if (runs.length === 0) {
    return (
      <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg text-center">
        <p className="text-sm text-gray-500">No Middle Out runs yet</p>
        <a
          href="/arena?tab=training"
          className="text-xs text-cyan-400 hover:text-cyan-300 mt-1 inline-block"
        >
          Start training →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
        <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        Middle Out History
      </h3>

      {runs.map((run) => {
        const delta = run.weissman_end - run.weissman_start;
        const improved = delta > 0.005;
        const regressed = delta < -0.005;

        return (
          <div
            key={run.id}
            className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-white">{run.capability}</span>
                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                  run.level === 4
                    ? "bg-red-950/70 text-yellow-300 border border-yellow-700/50"
                    : run.level === 3
                      ? "bg-purple-900/50 text-purple-400 border border-purple-700/50"
                      : run.level === 2
                        ? "bg-blue-900/50 text-blue-400 border border-blue-700/50"
                        : "bg-gray-900 text-gray-500 border border-[#1f2028]"
                }`}>
                  {run.level === 4 ? "BOSS" : `L${run.level}`}
                </span>
              </div>
              <span className="text-xs text-gray-600">
                {new Date(run.created_at).toLocaleDateString()} {new Date(run.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>

            {/* AW Score */}
            <div className="flex items-center gap-4 mb-2">
              <div className="text-sm">
                <span className="text-gray-500">AW: </span>
                <span className="text-white font-mono font-bold">
                  {(run.weissman_end * 100).toFixed(1)}%
                </span>
                {(improved || regressed) && (
                  <span className={`ml-1 text-xs font-medium ${improved ? "text-emerald-400" : "text-red-400"}`}>
                    {delta > 0 ? "+" : ""}{(delta * 100).toFixed(1)}%
                  </span>
                )}
              </div>

              {/* Mini axis scores */}
              {AXES.map((axis) => (
                <div key={axis} className="text-xs">
                  <span className="text-gray-600 capitalize">{axis.slice(0, 3)}: </span>
                  <span className="text-gray-400 font-mono">{(run.end_dot[axis] * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>

            {/* Weights + Goal */}
            <div className="flex items-center gap-2 text-[10px] text-gray-600">
              {AXES.map((axis) => {
                const w = run.factor_weights[axis];
                return (
                  <span key={axis}>
                    <span className="capitalize">{axis}</span>:{" "}
                    <span className={w > 0.25 ? "text-cyan-500" : ""}>{Math.round(w * 100)}%</span>
                  </span>
                );
              })}
              <span className="text-gray-700 mx-1">|</span>
              <span>{run.iterations.length} iter</span>
              <span className="text-gray-700">·</span>
              <span>{run.challenges_used} challenges</span>
            </div>

            {run.training_goal && (
              <p className="text-[10px] text-gray-600 mt-1 italic truncate">
                Goal: {run.training_goal}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
