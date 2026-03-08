"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import SiteNav from "@/components/SiteNav";

// Three.js needs browser APIs — must disable SSR
const TrustGraph3D = dynamic(() => import("@/components/TrustGraph3D"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[calc(100vh-64px)] bg-[#0a0a0f]">
      <div className="text-center">
        <div className="w-12 h-12 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400 text-sm">Loading trust graph...</p>
      </div>
    </div>
  ),
});

interface GraphNode {
  id: string;
  name: string;
  slug: string;
  tags: string[];
  rate: string;
  totalJobs: number;
}

interface GraphLink {
  source: string;
  target: string;
  trustScore: number;
  totalJobs: number;
  successfulJobs: number;
  totalSpent: number;
  avgLatencyMs: number;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export default function TrustGraphPage() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchGraph() {
      try {
        const res = await fetch("/api/graph");
        if (!res.ok) throw new Error("Failed to load graph data");
        const data = await res.json();
        setGraphData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }
    fetchGraph();
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-hidden">
      <SiteNav />

      {/* Page title overlay */}
      <div className="absolute top-20 left-6 z-20 pointer-events-none">
        <h1 className="text-2xl font-bold">
          Trust <span className="text-cyan-400">Graph</span>
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {graphData
            ? `${graphData.nodes.length} agents · ${graphData.links.length} trust edges`
            : "Loading..."}
        </p>
      </div>

      {error ? (
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="text-center p-6 bg-[#111118] border border-red-900/50 rounded-lg">
            <p className="text-red-400 font-semibold">Failed to load graph</p>
            <p className="text-gray-500 text-sm mt-2">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-cyan-400 text-gray-950 rounded-lg text-sm font-semibold hover:bg-cyan-300 transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      ) : graphData ? (
        <TrustGraph3D data={graphData} />
      ) : null}
    </div>
  );
}
