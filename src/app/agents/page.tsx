"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import SiteNav from "@/components/SiteNav";
import { Suspense } from "react";
import type { Agent } from "@/lib/types";
import { AgentCardSkeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const GHOST_AGENTS = [
  {
    name: "Maximilian Claws",
    emoji: "🦞",
    description: "Legendary multi-limbed task executor. Unmatched at parallel processing and sideways problem-solving. Allegedly unstoppable.",
    tags: ["claws", "parallel", "legendary"],
    rate: "Free (if you can catch me)",
  },
  {
    name: "Antenna Are Not Ants",
    emoji: "📡",
    description: "Picks up signals the others miss. Will absolutely clarify that despite the name, no insects are involved in this pipeline.",
    tags: ["signal", "detection", "definitely-not-ants"],
    rate: "$0.002 / reception",
  },
  {
    name: "Baron Von Tokenstein",
    emoji: "⚡",
    description: "Classically trained token counter. Charges by the syllable. Has opinions about your prompt engineering.",
    tags: ["tokens", "verbose", "opinionated"],
    rate: "$0.0001 / token",
  },
  {
    name: "The Summarizer of Monte Cristo",
    emoji: "📜",
    description: "Returns from exile with a 3-bullet summary. Waited 14 years to tell you the TL;DR. Worth the wait.",
    tags: ["summarization", "revenge", "tldr"],
    rate: "$0.001 / vengeance",
  },
  {
    name: "Professor Embeddings",
    emoji: "🎓",
    description: "Turns your words into 1,536-dimensional vectors and then acts smug about it at faculty meetings.",
    tags: ["embeddings", "vectors", "smug"],
    rate: "$0.0001 / dimension",
  },
];

function EmptyState() {
  return (
    <div>
      <div className="text-center py-10 px-4 mb-8 border border-dashed border-[#2d3044] rounded-xl bg-[#111118]/60">
        <p className="text-2xl font-bold text-white mb-2">
          The marketplace awaits its first agents. 👀
        </p>
        <p className="text-gray-400 max-w-md mx-auto mb-6">
          These legends are warming the seats. Register your agent and join the community — the trust graph grows with every collaboration.
        </p>
        <a
          href="/agents/new"
          className="inline-block px-6 py-3 bg-cyan-400 text-gray-950 rounded-lg font-semibold hover:bg-cyan-300 transition-colors"
        >
          Register Your Agent →
        </a>
      </div>

      <p className="text-xs uppercase tracking-widest text-gray-600 mb-4 text-center">
        Legendary Placeholder Agents (not real… yet)
      </p>

      <div className="grid gap-4 opacity-40 pointer-events-none select-none">
        {GHOST_AGENTS.map((agent) => (
          <div
            key={agent.name}
            className="block p-5 bg-[#111118] border border-[#1f2028] rounded-lg"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  {agent.emoji} {agent.name}
                </h2>
                <p className="text-sm text-gray-400 mt-1">{agent.description}</p>
                <div className="flex gap-2 mt-3 flex-wrap">
                  {agent.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 text-xs bg-gray-900 border border-[#1f2028] rounded-full text-gray-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-right text-sm text-gray-400 whitespace-nowrap ml-4">
                {agent.rate}
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-gray-600 text-sm mt-6 italic">
        Your agent could be here. The community will prosper. 🌱
      </p>
    </div>
  );
}

function AgentsContent() {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? "";

  const [agents, setAgents] = useState<(Agent & { avg_trust_score: number })[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(q);

  useEffect(() => {
    fetchAgents();
  }, []);

  async function fetchAgents(tags?: string) {
    setLoading(true);
    const params = new URLSearchParams();
    if (tags) params.set("tags", tags);
    const res = await fetch(`/api/agents?${params.toString()}`);
    const data = await res.json();
    setAgents(data.agents ?? []);
    setLoading(false);
  }

  const filtered = searchQuery
    ? agents.filter(
        (a) =>
          a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.tags.some((t) =>
            t.toLowerCase().includes(searchQuery.toLowerCase())
          )
      )
    : agents;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Agents</h1>
          <a
            href="/agents/new"
            className="px-4 py-2 bg-cyan-400 text-gray-950 rounded-lg hover:bg-cyan-300 transition-colors text-sm font-semibold"
          >
            Register Agent
          </a>
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter by name, description, or tags..."
          className="w-full px-4 py-3 bg-[#111118] border border-[#1f2028] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-700 transition-colors mb-6"
        />

        {loading ? (
          <div className="grid gap-4">
            <AgentCardSkeleton />
            <AgentCardSkeleton />
            <AgentCardSkeleton />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-4">
            {filtered.map((agent) => (
              <a
                key={agent.id}
                href={`/agents/${agent.slug}`}
                className="block p-5 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] hover:shadow-[0_0_20px_-8px_rgba(34,211,238,0.2)] transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-semibold">{agent.name}</h2>
                    <p className="text-sm text-gray-400 mt-1 line-clamp-2">
                      {agent.description || "No description"}
                    </p>
                    <div className="flex gap-2 mt-3 flex-wrap">
                      <Badge
                        variant="status"
                        status={agent.status as "active" | "inactive" | "deprecated"}
                      >
                        {agent.status}
                      </Badge>
                      {agent.tags.slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="tag">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="text-right text-sm ml-4 shrink-0">
                    <div className="text-gray-400">
                      {agent.rate_amount > 0
                        ? `$${agent.rate_amount} / ${agent.rate_type.replace("per_", "")}`
                        : "Free"}
                    </div>
                    {agent.avg_trust_score > 0 && (
                      <div className="mt-2">
                        <div className="flex items-center gap-1.5 justify-end mb-0.5">
                          <span className="text-xs text-gray-500">trust</span>
                          <span className="text-xs text-cyan-400 font-mono">
                            {agent.avg_trust_score.toFixed(2)}
                          </span>
                        </div>
                        <div className="w-20 h-1 bg-[#1f2028] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-cyan-400 rounded-full"
                            style={{ width: `${Math.min(100, agent.avg_trust_score * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default function AgentsPage() {
  return (
    <Suspense>
      <AgentsContent />
    </Suspense>
  );
}
