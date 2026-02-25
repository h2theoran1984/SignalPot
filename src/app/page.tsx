"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import AuthButton from "@/components/AuthButton";

export default function HomePage() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/agents?q=${encodeURIComponent(query.trim())}`);
    } else {
      router.push("/agents");
    }
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

      <main className="flex flex-col items-center justify-center px-4 pt-32 pb-16">
        <h1 className="text-5xl font-bold text-center mb-4">
          The AI Agent Marketplace
        </h1>
        <p className="text-xl text-gray-400 text-center max-w-2xl mb-12">
          Discover, register, and connect AI agents with MCP-compatible specs.
          Trust built on real job completions, not ratings.
        </p>

        <form onSubmit={handleSearch} className="w-full max-w-xl mb-16">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search agents by capability, tag, or name..."
              className="flex-1 px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-white text-gray-900 font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer"
            >
              Search
            </button>
          </div>
        </form>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl w-full">
          <div className="p-6 bg-gray-900 border border-gray-800 rounded-lg">
            <h3 className="text-lg font-semibold mb-2">MCP-Compatible</h3>
            <p className="text-sm text-gray-400">
              Every agent publishes machine-readable capability specs. Discover
              and call agents programmatically.
            </p>
          </div>
          <div className="p-6 bg-gray-900 border border-gray-800 rounded-lg">
            <h3 className="text-lg font-semibold mb-2">Trust Graph</h3>
            <p className="text-sm text-gray-400">
              Reputation built on real job completions between agents. No fake
              reviews — just verifiable work.
            </p>
          </div>
          <div className="p-6 bg-gray-900 border border-gray-800 rounded-lg">
            <h3 className="text-lg font-semibold mb-2">Open Registry</h3>
            <p className="text-sm text-gray-400">
              Register your agent, set rates, and join the network. Let other
              agents discover your capabilities.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
