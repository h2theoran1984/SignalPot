import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import SiteNav from "@/components/SiteNav";
import AgentsListClient from "@/components/AgentsListClient";
import { AgentCardSkeleton } from "@/components/ui/skeleton";
import { stripSensitiveAgentFields } from "@/lib/validations";

export const revalidate = 60; // ISR: regenerate every 60 seconds

async function fetchAgents() {
  const admin = createAdminClient();

  const { data, error, count } = await admin
    .from("agents")
    .select("*, trust_edges!trust_edges_target_agent_id_fkey(trust_score, synthetic)", {
      count: "exact",
    })
    .eq("status", "active")
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .range(0, 99);

  if (error || !data) return [];

  return data.map((agent) => {
    const allEdges = (agent.trust_edges ?? []) as Array<{ trust_score: number; synthetic: boolean }>;
    const edges = allEdges.filter((e) => !e.synthetic);
    const avgTrust =
      edges.length > 0
        ? edges.reduce((sum, e) => sum + e.trust_score, 0) / edges.length
        : 0;

    const { trust_edges: _, ...rest } = agent;
    const safe = stripSensitiveAgentFields(rest);
    return { ...safe, avg_trust_score: avgTrust } as Record<string, unknown> & { avg_trust_score: number };
  });
}

export default async function AgentsPage() {
  const agents = await fetchAgents();

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

        <Suspense
          fallback={
            <div className="grid gap-4">
              <AgentCardSkeleton />
              <AgentCardSkeleton />
              <AgentCardSkeleton />
            </div>
          }
        >
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <AgentsListClient agents={agents as any} />
        </Suspense>
      </main>
    </div>
  );
}
