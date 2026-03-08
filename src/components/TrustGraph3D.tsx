"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import { useRouter } from "next/navigation";
import * as THREE from "three";

/* ─────────────────────── Types ─────────────────────── */

interface GraphNode {
  id: string;
  name: string;
  slug: string;
  tags: string[];
  rate: string;
  totalJobs: number;
  x?: number;
  y?: number;
  z?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
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

interface TrustGraph3DProps {
  data: GraphData;
}

/* ─────────────────────── Component ─────────────────────── */

export default function TrustGraph3D({ data }: TrustGraph3DProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const router = useRouter();
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);

  // ── Responsive sizing ──
  useEffect(() => {
    function updateSize() {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight - 64,
      });
    }
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // ── Auto-rotation + scene setup ──
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    // Dark background matching site
    const scene = graph.scene();
    if (scene) {
      scene.background = new THREE.Color(0x0a0a0f);
    }

    // Enable gentle auto-rotation
    const controls = graph.controls();
    if (controls && "autoRotate" in controls) {
      (controls as any).autoRotate = true;
      (controls as any).autoRotateSpeed = 0.5;
    }
  }, [data]);

  // ── Node click → navigate ──
  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (node.slug) {
        router.push(`/agents`);
      }
    },
    [router]
  );

  // ── Hover: show tooltip + pause rotation ──
  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setHoveredNode(node);
    const controls = graphRef.current?.controls();
    if (controls && "autoRotate" in controls) {
      (controls as any).autoRotate = !node;
    }
  }, []);

  // ── Node sizing: scale by total jobs ──
  const maxJobs = Math.max(1, ...data.nodes.map((n) => n.totalJobs));

  return (
    <div className="relative">
      <ForceGraph3D
        ref={graphRef}
        graphData={data}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="#0a0a0f"
        /* ── Nodes ── */
        nodeLabel=""
        nodeColor={() => "#22d3ee"}
        nodeVal={(node: any) => 2 + ((node as GraphNode).totalJobs / maxJobs) * 10}
        nodeOpacity={0.9}
        nodeResolution={16}
        /* ── Links ── */
        linkColor={() => "rgba(251, 146, 60, 0.6)"}
        linkWidth={(link: any) => {
          const score =
            typeof (link as GraphLink).trustScore === "number"
              ? (link as GraphLink).trustScore
              : 0;
          return 0.5 + score * 2.5;
        }}
        linkOpacity={0.4}
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={(link: any) => {
          const score =
            typeof (link as GraphLink).trustScore === "number"
              ? (link as GraphLink).trustScore
              : 0;
          return 0.5 + score * 1.5;
        }}
        linkDirectionalParticleColor={() => "#fb923c"}
        linkDirectionalParticleSpeed={0.005}
        /* ── Interactions ── */
        onNodeClick={handleNodeClick as any}
        onNodeHover={handleNodeHover as any}
        /* ── Physics ── */
        d3VelocityDecay={0.3}
        warmupTicks={50}
        cooldownTime={3000}
      />

      {/* ── Hover tooltip ── */}
      {hoveredNode && (
        <div className="absolute top-4 left-4 p-4 bg-[#111118]/95 border border-[#1f2028] rounded-lg backdrop-blur-sm max-w-xs z-20 pointer-events-none">
          <h3 className="text-white font-semibold text-lg">{hoveredNode.name}</h3>
          {hoveredNode.tags.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {hoveredNode.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 text-xs bg-[#0a0a0f] border border-[#1f2028] rounded-full text-gray-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 text-sm text-gray-400">
            <span className="text-cyan-400 font-mono">{hoveredNode.totalJobs}</span>{" "}
            jobs
            <span className="mx-2 text-gray-600">|</span>
            {hoveredNode.rate}
          </div>
          <p className="text-xs text-gray-500 mt-2">Click to view agents</p>
        </div>
      )}

      {/* ── Legend ── */}
      <div className="absolute bottom-6 right-6 p-3 bg-[#111118]/90 border border-[#1f2028] rounded-lg backdrop-blur-sm z-20">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3 h-3 rounded-full bg-cyan-400" />
          <span className="text-xs text-gray-400">Agent (size = total jobs)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-0.5 bg-orange-400" />
          <span className="text-xs text-gray-400">
            Trust edge (width = trust score)
          </span>
        </div>
      </div>
    </div>
  );
}
