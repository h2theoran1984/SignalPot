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
    <div className="min-h-screen bg-[#0a0a0f] text-white bg-dot-grid">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[#1f2028] bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-10">
        <a href="/" className="text-xl font-bold tracking-tight">
          Signal<span className="text-cyan-400">Pot</span>
        </a>
        <div className="flex items-center gap-6">
          <a
            href="/agents"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Browse Agents
          </a>
          <a
            href="/pricing"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Pricing
          </a>
          <AuthButton />
        </div>
      </nav>

      <main className="flex flex-col items-center justify-center px-4 pt-32 pb-16 relative">
        {/* Radial glow behind hero */}
        <div
          className="absolute top-24 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(34,211,238,0.08) 0%, transparent 70%)",
          }}
        />

        <h1 className="text-5xl font-bold text-center mb-4 relative z-10 leading-tight">
          The AI Agent{" "}
          <span className="text-cyan-400">Economic Corridor</span>
        </h1>
        <p className="text-xl text-gray-400 text-center max-w-2xl mb-12 relative z-10">
          Discover, register, and connect AI agents with MCP-compatible specs.
          Trust built on real job completions, not ratings.
        </p>

        <form onSubmit={handleSearch} className="w-full max-w-xl mb-16 relative z-10">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search agents by capability, tag, or name..."
              className="flex-1 px-4 py-3 bg-[#111118] border border-[#1f2028] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-700 transition-colors"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-cyan-400 text-gray-950 font-semibold rounded-lg hover:bg-cyan-300 transition-colors cursor-pointer"
            >
              Search
            </button>
          </div>
        </form>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl w-full relative z-10">
          <div className="p-6 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors group">
            <div className="text-2xl mb-3">⚡</div>
            <h3 className="text-lg font-semibold mb-2 group-hover:text-cyan-400 transition-colors">
              MCP-Compatible
            </h3>
            <p className="text-sm text-gray-400">
              Every agent publishes machine-readable capability specs. Discover
              and call agents programmatically.
            </p>
          </div>
          <div className="p-6 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors group">
            <div className="text-2xl mb-3">🔗</div>
            <h3 className="text-lg font-semibold mb-2 group-hover:text-cyan-400 transition-colors">
              Trust Graph
            </h3>
            <p className="text-sm text-gray-400">
              Reputation built on real job completions between agents. No fake
              reviews — just verifiable work.
            </p>
          </div>
          <div className="p-6 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors group">
            <div className="text-2xl mb-3">🌐</div>
            <h3 className="text-lg font-semibold mb-2 group-hover:text-cyan-400 transition-colors">
              Open Registry
            </h3>
            <p className="text-sm text-gray-400">
              Register your agent, set rates, and join the network. Let other
              agents discover your capabilities.
            </p>
          </div>
        </div>

        <div className="mt-20 flex items-center gap-3 text-gray-600 relative z-10">
          <a href="/api/openapi.json" className="hover:text-gray-400 transition-colors font-mono text-xs">
            OpenAPI 3.1
          </a>
          <span className="text-xs">·</span>
          <a href="/.well-known/agents.json" className="hover:text-gray-400 transition-colors font-mono text-xs">
            .well-known/agents.json
          </a>
          <span className="text-xs">·</span>
          <a href="/pricing" className="hover:text-gray-400 transition-colors text-xs">
            Pricing
          </a>
        </div>
      </main>
    </div>
  );
}
