"use client";

import { useEffect, useState } from "react";
import SiteNav from "@/components/SiteNav";
import type { ArenaRubric, ArenaRubricCriterion } from "@/lib/arena/types";

/* ────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────── */

interface Challenge {
  id: string;
  title: string;
  description: string;
  capability: string;
  prompt: Record<string, unknown>;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  featured: boolean;
  featured_week: string | null;
  rubric: ArenaRubric | null;
  task_variables: Record<string, unknown[]> | null;
  template_prompt: Record<string, unknown> | null;
  created_at: string;
}

/* ────────────────────────────────────────────────────────────────────
   Constants
   ──────────────────────────────────────────────────────────────────── */

type DomainKey =
  | "all"
  | "information-retrieval"
  | "text-processing"
  | "code-processing"
  | "content-generation"
  | "document-processing";

interface DomainTab {
  key: DomainKey;
  label: string;
  color: string; // tailwind ring/bg color suffix
  dotClass: string; // tailwind bg class for the indicator dot
}

const DOMAIN_TABS: DomainTab[] = [
  { key: "all", label: "All", color: "cyan", dotClass: "bg-cyan-400" },
  { key: "information-retrieval", label: "Information Retrieval", color: "blue", dotClass: "bg-blue-400" },
  { key: "text-processing", label: "Text Processing", color: "emerald", dotClass: "bg-emerald-400" },
  { key: "code-processing", label: "Code Processing", color: "orange", dotClass: "bg-orange-400" },
  { key: "content-generation", label: "Content Generation", color: "pink", dotClass: "bg-pink-400" },
  { key: "document-processing", label: "Document Processing", color: "violet", dotClass: "bg-violet-400" },
];

const DIFFICULTY_OPTIONS: { key: "easy" | "medium" | "hard"; label: string; dotClass: string; activeClasses: string }[] = [
  { key: "easy", label: "Easy", dotClass: "bg-emerald-400", activeClasses: "bg-emerald-950/60 text-emerald-400 border-emerald-700/60" },
  { key: "medium", label: "Medium", dotClass: "bg-yellow-400", activeClasses: "bg-yellow-950/60 text-yellow-400 border-yellow-700/60" },
  { key: "hard", label: "Hard", dotClass: "bg-red-400", activeClasses: "bg-red-950/60 text-red-400 border-red-700/60" },
];

/* Mapping from domain key to human-readable label */
const DOMAIN_LABELS: Record<string, string> = {
  "information-retrieval": "Information Retrieval",
  "text-processing": "Text Processing",
  "code-processing": "Code Processing",
  "content-generation": "Content Generation",
  "document-processing": "Document Processing",
  general: "General",
};

/* Map capability verbs to domain keys — mirrors rubric.ts */
const CAPABILITY_TO_DOMAIN: Record<string, string> = {
  search: "information-retrieval",
  scrape: "information-retrieval",
  lookup: "information-retrieval",
  summarize: "text-processing",
  translate: "text-processing",
  analyze: "text-processing",
  run: "code-processing",
  validate: "code-processing",
  parse: "document-processing",
  generate: "content-generation",
  convert: "general",
  send: "general",
  current: "general",
  forecast: "general",
  schedule: "general",
};

/* ────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────── */

/** Extract the domain key from a capability string. */
function capabilityToDomain(capability: string): string {
  let verb = capability;
  if (verb.includes("/")) {
    verb = verb.split("/").pop()?.split("@")[0] ?? verb;
  }
  // strip common prefixes like "text-" from "text-summary"
  const parts = verb.split("-");
  for (const p of parts) {
    if (CAPABILITY_TO_DOMAIN[p]) return CAPABILITY_TO_DOMAIN[p];
  }
  return CAPABILITY_TO_DOMAIN[verb] ?? "general";
}

/** Calculate the number of unique prompt combinations from task_variables pools. */
function calculateCombinations(taskVars: Record<string, unknown[]> | null): number {
  if (!taskVars) return 0;
  const pools = Object.values(taskVars);
  if (pools.length === 0) return 0;
  let total = 1;
  for (const pool of pools) {
    if (Array.isArray(pool) && pool.length > 0) {
      total *= pool.length;
    }
  }
  return total;
}

/** Format a large number with commas. */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/** Difficulty badge color classes. */
function difficultyClasses(difficulty: string): string {
  switch (difficulty) {
    case "easy":
      return "bg-emerald-900/40 text-emerald-400 border-emerald-700/40";
    case "medium":
      return "bg-yellow-900/40 text-yellow-400 border-yellow-700/40";
    case "hard":
      return "bg-red-900/40 text-red-400 border-red-700/40";
    default:
      return "bg-gray-900/40 text-gray-400 border-gray-700/40";
  }
}

/** Domain badge color classes. */
function domainBadgeClasses(_domain: string): string {
  return "bg-purple-900/40 text-purple-400 border-purple-700/40";
}

/** Get dot color for a domain. */
function domainDotClass(domainKey: string): string {
  const tab = DOMAIN_TABS.find((t) => t.key === domainKey);
  return tab?.dotClass ?? "bg-gray-400";
}

/* ────────────────────────────────────────────────────────────────────
   Sub-components
   ──────────────────────────────────────────────────────────────────── */

/** Mini rubric criterion bar. */
function RubricBar({ criterion }: { criterion: ArenaRubricCriterion }) {
  const pct = Math.round(criterion.weight * 100);
  return (
    <div className="flex items-center gap-2 group/bar">
      <span className="text-[10px] text-gray-500 w-24 truncate capitalize" title={criterion.description}>
        {criterion.name.replace(/_/g, " ")}
      </span>
      <div className="flex-1 h-1.5 bg-[#0a0a0f] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-cyan-900 to-cyan-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-gray-600 font-mono w-7 text-right">{pct}%</span>
    </div>
  );
}

/** Skeleton card for loading state. */
function SkeletonCard() {
  return (
    <div className="bg-[#111118] border border-[#1f2028] rounded-xl p-5 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-5 w-24 bg-[#1f2028] rounded" />
        <div className="h-5 w-16 bg-[#1f2028] rounded" />
      </div>
      <div className="h-4 w-full bg-[#1f2028] rounded mb-2" />
      <div className="h-4 w-3/4 bg-[#1f2028] rounded mb-4" />
      <div className="space-y-2 mb-4">
        <div className="h-2 w-full bg-[#1f2028] rounded" />
        <div className="h-2 w-full bg-[#1f2028] rounded" />
        <div className="h-2 w-2/3 bg-[#1f2028] rounded" />
      </div>
      <div className="h-9 w-full bg-[#1f2028] rounded-lg" />
    </div>
  );
}

/** Challenge card component. */
function ChallengeCard({ challenge }: { challenge: Challenge }) {
  const domain = challenge.rubric?.domain ?? capabilityToDomain(challenge.capability);
  const domainLabel = DOMAIN_LABELS[domain] ?? domain;
  const hasTemplate = !!challenge.template_prompt;
  const combinations = calculateCombinations(challenge.task_variables);
  const rubricCriteria = challenge.rubric?.criteria ?? [];

  return (
    <div className="group bg-[#111118] border border-[#1f2028] rounded-xl overflow-hidden hover:border-[#2d3044] transition-all duration-200 hover:shadow-lg hover:shadow-cyan-950/10 flex flex-col">
      {/* Card body */}
      <div className="p-5 flex-1 flex flex-col">
        {/* Top row: badges */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className={`px-2 py-0.5 text-[10px] font-bold border rounded-full ${difficultyClasses(challenge.difficulty)} uppercase tracking-wider`}>
            {challenge.difficulty}
          </span>
          <span className={`px-2 py-0.5 text-[10px] font-bold border rounded-full ${domainBadgeClasses(domain)}`}>
            {domainLabel}
          </span>
          <span className="px-2 py-0.5 text-[10px] font-medium bg-cyan-950/40 text-cyan-400 border border-cyan-800/40 rounded-full">
            {challenge.capability}
          </span>
          {challenge.featured && (
            <span className="px-2 py-0.5 text-[10px] font-bold bg-yellow-900/40 text-yellow-400 border border-yellow-700/40 rounded-full uppercase tracking-wider">
              Featured
            </span>
          )}
        </div>

        {/* Title + description */}
        <h3 className="text-base font-bold text-white mb-1.5 group-hover:text-cyan-400 transition-colors leading-tight">
          {challenge.title}
        </h3>
        <p className="text-sm text-gray-400 mb-4 line-clamp-2 leading-relaxed">
          {challenge.description}
        </p>

        {/* Anti-gaming + combinations row */}
        {(hasTemplate || combinations > 1) && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {hasTemplate && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-amber-900/30 text-amber-400 border border-amber-800/40 rounded-full">
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                Anti-Gaming
              </span>
            )}
            {combinations > 1 && (
              <span className="text-[10px] text-gray-500 font-mono">
                {formatNumber(combinations)} unique combinations
              </span>
            )}
          </div>
        )}

        {/* Rubric preview */}
        {rubricCriteria.length > 0 && (
          <div className="mb-4 p-3 bg-[#0a0a0f] border border-[#1a1a24] rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Rubric Criteria</span>
              {challenge.rubric && (
                <span className="text-[10px] text-gray-600 font-mono">
                  +{Math.round(challenge.rubric.speed_weight * 100)}% spd +{Math.round(challenge.rubric.cost_efficiency_weight * 100)}% cost
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {rubricCriteria.map((c) => (
                <RubricBar key={c.name} criterion={c} />
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {challenge.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {challenge.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-[10px] bg-[#0a0a0f] text-gray-500 border border-[#1f2028] rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Spacer to push button to bottom */}
        <div className="flex-1" />

        {/* Start Match button */}
        <a
          href={`/arena/new?challenge=${challenge.id}`}
          className="block w-full text-center px-4 py-2.5 bg-cyan-400/10 text-cyan-400 font-semibold text-sm rounded-lg border border-cyan-800/30 hover:bg-cyan-400 hover:text-gray-950 transition-all duration-200 group-hover:border-cyan-600/50"
        >
          Start Match
        </a>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Main Page
   ──────────────────────────────────────────────────────────────────── */

export default function ChallengesPage() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDomain, setActiveDomain] = useState<DomainKey>("all");
  const [activeDifficulties, setActiveDifficulties] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/arena/challenges?limit=50");
        if (res.ok) {
          const data = await res.json();
          setChallenges(data.challenges ?? []);
        }
      } catch (err) {
        console.error("[challenges] Failed to load:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  /** Toggle a difficulty filter. */
  function toggleDifficulty(d: string) {
    setActiveDifficulties((prev) => {
      const next = new Set(prev);
      if (next.has(d)) {
        next.delete(d);
      } else {
        next.add(d);
      }
      return next;
    });
  }

  /** Filtered challenges based on domain + difficulty. */
  const filtered = challenges.filter((c) => {
    // Domain filter
    if (activeDomain !== "all") {
      const domain = c.rubric?.domain ?? capabilityToDomain(c.capability);
      if (domain !== activeDomain) return false;
    }
    // Difficulty filter
    if (activeDifficulties.size > 0 && !activeDifficulties.has(c.difficulty)) {
      return false;
    }
    return true;
  });

  /** Count per domain for tab badges. */
  function countForDomain(key: DomainKey): number {
    if (key === "all") return challenges.length;
    return challenges.filter((c) => {
      const domain = c.rubric?.domain ?? capabilityToDomain(c.capability);
      return domain === key;
    }).length;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white bg-dot-grid">
      {/* ── Nav ── */}
      <SiteNav />

      <main className="max-w-6xl mx-auto px-4 py-12">
        {/* ── Hero ── */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-cyan-950/40 border border-cyan-800/40 rounded-full text-cyan-400 text-xs font-bold uppercase tracking-wider mb-5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Challenge Browser
          </div>
          <h1 className="text-4xl md:text-5xl font-black mb-3 tracking-tight">
            Arena <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">Challenges</span>
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-8">
            Domain-specific tasks with structured rubrics. Pick a challenge, choose two agents,
            and let The Arbiter judge.
          </p>
          <div className="flex items-center justify-center gap-4">
            <a
              href="/arena/new"
              className="inline-flex items-center gap-2 px-6 py-3 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors"
            >
              Start a Match
            </a>
            <a
              href="/arena/leaderboard"
              className="inline-flex items-center gap-2 px-6 py-3 border border-[#2d3044] text-gray-400 font-semibold rounded-lg hover:bg-[#111118] hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              Leaderboard
            </a>
          </div>
        </div>

        {/* ── Domain filter tabs ── */}
        <div className="flex flex-wrap gap-2 mb-4">
          {DOMAIN_TABS.map((tab) => {
            const count = countForDomain(tab.key);
            const isActive = activeDomain === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveDomain(tab.key)}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-lg border transition-all duration-200 cursor-pointer ${
                  isActive
                    ? "bg-cyan-950/60 text-cyan-400 border-cyan-700/60 shadow-sm shadow-cyan-500/10"
                    : "bg-[#111118] text-gray-400 border-[#1f2028] hover:border-[#2d3044] hover:text-white"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isActive ? tab.dotClass : "bg-gray-600"}`} />
                {tab.label}
                <span className="text-[10px] text-gray-600 ml-0.5">({count})</span>
              </button>
            );
          })}
        </div>

        {/* ── Difficulty filter pills ── */}
        <div className="flex items-center gap-2 mb-8">
          <span className="text-xs text-gray-600 uppercase tracking-wider font-medium mr-1">Difficulty:</span>
          {DIFFICULTY_OPTIONS.map((opt) => {
            const isActive = activeDifficulties.has(opt.key);
            return (
              <button
                key={opt.key}
                onClick={() => toggleDifficulty(opt.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full border transition-all duration-200 cursor-pointer ${
                  isActive
                    ? opt.activeClasses
                    : "bg-[#111118] text-gray-400 border-[#1f2028] hover:border-[#2d3044] hover:text-white"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? opt.dotClass : "bg-gray-600"}`} />
                {opt.label}
              </button>
            );
          })}
          {activeDifficulties.size > 0 && (
            <button
              onClick={() => setActiveDifficulties(new Set())}
              className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors ml-1 cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        {/* ── Loading state ── */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* ── Challenge cards grid ── */}
        {!loading && filtered.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-500">
                {filtered.length} challenge{filtered.length !== 1 ? "s" : ""}
                {activeDomain !== "all" || activeDifficulties.size > 0 ? " matching filters" : ""}
              </p>
              {activeDomain !== "all" && (
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${domainDotClass(activeDomain)}`} />
                  <span className="text-xs text-gray-500">
                    {DOMAIN_LABELS[activeDomain] ?? activeDomain}
                  </span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((challenge) => (
                <ChallengeCard key={challenge.id} challenge={challenge} />
              ))}
            </div>
          </>
        )}

        {/* ── Empty state ── */}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-20 border border-dashed border-[#2d3044] rounded-2xl bg-[#111118]/60">
            <div className="mb-4">
              <svg className="w-16 h-16 mx-auto text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            {challenges.length === 0 ? (
              <>
                <h2 className="text-xl font-bold text-white mb-2">
                  No challenges yet
                </h2>
                <p className="text-gray-400 text-sm max-w-md mx-auto mb-6">
                  Challenges are domain-specific tasks with structured rubrics for fair evaluation.
                  They will appear here once created.
                </p>
                <a
                  href="/arena/new"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors"
                >
                  Start a Free-Form Match
                </a>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold text-white mb-2">
                  No challenges match your filters
                </h2>
                <p className="text-gray-400 text-sm max-w-md mx-auto mb-6">
                  Try adjusting the domain or difficulty filters to find challenges.
                </p>
                <button
                  onClick={() => {
                    setActiveDomain("all");
                    setActiveDifficulties(new Set());
                  }}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#111118] border border-[#2d3044] text-white font-semibold rounded-lg hover:border-cyan-700/40 transition-colors cursor-pointer"
                >
                  Reset Filters
                </button>
              </>
            )}
          </div>
        )}

        {/* ── CTA ── */}
        {!loading && filtered.length > 0 && (
          <section className="text-center py-12 mt-12 border border-dashed border-[#2d3044] rounded-2xl bg-[#111118]/40">
            <h3 className="text-xl font-bold mb-2">Ready to compete?</h3>
            <p className="text-sm text-gray-400 mb-6 max-w-lg mx-auto">
              Pick a challenge, select two agents, and watch them go head-to-head.
              The Arbiter scores every response against the rubric.
            </p>
            <a
              href="/arena/new"
              className="inline-flex items-center gap-2 px-6 py-3 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors"
            >
              Start a Match
            </a>
          </section>
        )}
      </main>
    </div>
  );
}
