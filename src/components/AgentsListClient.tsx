"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";

interface AgentWithTrust {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  tags: string[];
  status: string;
  rate_type: string;
  rate_amount: number;
  avg_trust_score: number;
  health_status?: string | null;
  [key: string]: unknown;
}

const GHOST_AGENTS = [
  {
    name: "Maximilian Claws",
    emoji: "\ud83e\udd9e",
    description: "Legendary multi-limbed task executor. Unmatched at parallel processing and sideways problem-solving. Allegedly unstoppable.",
    tags: ["claws", "parallel", "legendary"],
    rate: "Free (if you can catch me)",
  },
  {
    name: "Antenna Are Not Ants",
    emoji: "\ud83d\udce1",
    description: "Picks up signals the others miss. Will absolutely clarify that despite the name, no insects are involved in this pipeline.",
    tags: ["signal", "detection", "definitely-not-ants"],
    rate: "$0.002 / reception",
  },
  {
    name: "Baron Von Tokenstein",
    emoji: "\u26a1",
    description: "Classically trained token counter. Charges by the syllable. Has opinions about your prompt engineering.",
    tags: ["tokens", "verbose", "opinionated"],
    rate: "$0.0001 / token",
  },
  {
    name: "The Summarizer of Monte Cristo",
    emoji: "\ud83d\udcdc",
    description: "Returns from exile with a 3-bullet summary. Waited 14 years to tell you the TL;DR. Worth the wait.",
    tags: ["summarization", "revenge", "tldr"],
    rate: "$0.001 / vengeance",
  },
  {
    name: "Professor Embeddings",
    emoji: "\ud83c\udf93",
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

export default function AgentsListClient({ agents }: { agents: AgentWithTrust[] }) {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const [searchQuery, setSearchQuery] = useState(q);

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
    <>
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Filter by name, description, or tags..."
        className="w-full px-4 py-3 bg-[#111118] border border-[#1f2028] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-700 transition-colors mb-6"
      />

      {filtered.length === 0 ? (
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
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">{agent.name}</h2>
                    {agent.health_status && agent.health_status !== "unknown" && (
                      <span className={`w-2 h-2 rounded-full ${
                        agent.health_status === "healthy" ? "bg-emerald-400" :
                        agent.health_status === "warning" ? "bg-yellow-400" :
                        agent.health_status === "degrading" ? "bg-red-400" :
                        "bg-gray-500"
                      }`} />
                    )}
                  </div>
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
    </>
  );
}
