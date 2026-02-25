"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthButton from "@/components/AuthButton";
import { Suspense } from "react";
import type { Agent } from "@/lib/types";

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
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <a href="/" className="text-xl font-bold">
          SignalPot
        </a>
        <div className="flex items-center gap-4">
          <a
            href="/agents"
            className="text-sm text-white font-medium transition-colors"
          >
            Browse Agents
          </a>
          <AuthButton />
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Agents</h1>
          <a
            href="/agents/new"
            className="px-4 py-2 bg-white text-gray-900 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
          >
            Register Agent
          </a>
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter by name, description, or tags..."
          className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 mb-6"
        />

        {loading ? (
          <p className="text-gray-500">Loading agents...</p>
        ) : filtered.length === 0 ? (
          <p className="text-gray-500">
            No agents found. Be the first to{" "}
            <a href="/agents/new" className="text-white underline">
              register one
            </a>
            .
          </p>
        ) : (
          <div className="grid gap-4">
            {filtered.map((agent) => (
              <a
                key={agent.id}
                href={`/agents/${agent.slug}`}
                className="block p-5 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-600 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{agent.name}</h2>
                    <p className="text-sm text-gray-400 mt-1">
                      {agent.description || "No description"}
                    </p>
                    <div className="flex gap-2 mt-3">
                      {agent.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-xs bg-gray-800 border border-gray-700 rounded-full text-gray-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-gray-400">
                      {agent.rate_amount > 0
                        ? `$${agent.rate_amount} / ${agent.rate_type.replace("per_", "")}`
                        : "Free"}
                    </div>
                    {agent.avg_trust_score > 0 && (
                      <div className="text-green-400 mt-1">
                        Trust: {agent.avg_trust_score.toFixed(2)}
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
