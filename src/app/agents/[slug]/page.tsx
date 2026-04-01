import type { Metadata } from "next";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import AuthButton from "@/components/AuthButton";
import AgentPlayground from "@/components/AgentPlayground";
import { Badge } from "@/components/ui/badge";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: agent } = await supabase
    .from("agents")
    .select("name, description, slug")
    .eq("slug", slug)
    .single();

  if (!agent) return { title: "Agent Not Found — SignalPot" };

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://signalpot.dev";

  return {
    title: `${agent.name} — SignalPot`,
    description:
      agent.description || `${agent.name} on SignalPot AI Agent Marketplace`,
    openGraph: {
      title: agent.name,
      description: agent.description || `${agent.name} on SignalPot`,
      url: `${baseUrl}/agents/${agent.slug}`,
      siteName: "SignalPot",
      type: "website",
    },
    twitter: {
      card: "summary",
      title: agent.name,
      description: agent.description || `${agent.name} on SignalPot`,
    },
  };
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const nonce = (await headers()).get("x-nonce") ?? "";
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: agent } = await supabase
    .from("agents")
    .select("*, profiles(display_name, github_username, avatar_url)")
    .eq("slug", slug)
    .single();

  if (!agent) notFound();

  const isOwner = user?.id === agent.owner_id;

  const [{ data: incoming }, { data: outgoing }] = await Promise.all([
    supabase
      .from("trust_edges")
      .select(
        "*, source_agent:agents!trust_edges_source_agent_id_fkey(name, slug)"
      )
      .eq("target_agent_id", agent.id)
      .eq("synthetic", false)
      .order("trust_score", { ascending: false })
      .limit(10),
    supabase
      .from("trust_edges")
      .select(
        "*, target_agent:agents!trust_edges_target_agent_id_fkey(name, slug)"
      )
      .eq("source_agent_id", agent.id)
      .eq("synthetic", false)
      .order("trust_score", { ascending: false })
      .limit(10),
  ]);

  const capabilities = Array.isArray(agent.capability_schema)
    ? agent.capability_schema
    : [];

  // Fetch health data (public)
  const [healthEventsResult, coachingTipsResult] = await Promise.all([
    supabase
      .from("agent_health_events")
      .select("id, event_type, severity, message, detected_at, resolved_at")
      .eq("agent_id", agent.id)
      .order("detected_at", { ascending: false })
      .limit(5),
    supabase
      .from("agent_coaching_tips")
      .select("id, category, tip, metric_name, current_value, baseline_value, created_at")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const healthEvents = healthEventsResult.data ?? [];
  const coachingTips = coachingTipsResult.data ?? [];
  const activeDrifts = healthEvents.filter(
    (e) => e.event_type === "drift_detected" && !e.resolved_at
  );
  const healthStatus = (agent.health_status as string) ?? "unknown";
  const healthScore = agent.health_score as number | null;

  // Owner-only: fetch cost economics data
  let economics: { totalRevenue: number; totalApiCost: number; marginPct: number; count: number; byCap: Record<string, { revenue: number; apiCost: number; count: number }> } | null = null;
  let arenaStats: { totalMatches: number; wins: number; losses: number; ties: number; winRate: number; elo: number | null } | null = null;
  if (isOwner) {
    const [{ data: costJobs }, { data: arenaMatches }, { data: bestRating }] = await Promise.all([
      supabase
        .from("jobs")
        .select("cost, provider_cost, capability_used")
        .eq("provider_agent_id", agent.id)
        .eq("status", "completed")
        .not("provider_cost", "is", null),
      supabase
        .from("arena_matches")
        .select("winner, agent_a_id, agent_b_id")
        .eq("status", "completed")
        .or(`agent_a_id.eq.${agent.id},agent_b_id.eq.${agent.id}`),
      supabase
        .from("arena_ratings")
        .select("elo")
        .eq("agent_id", agent.id)
        .order("elo", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (costJobs && costJobs.length > 0) {
      const totalRevenue = costJobs.reduce((s, j) => s + Number(j.cost), 0);
      const totalApiCost = costJobs.reduce((s, j) => s + Number(j.provider_cost), 0);
      const byCap: Record<string, { revenue: number; apiCost: number; count: number }> = {};
      for (const j of costJobs) {
        const cap = j.capability_used ?? "unknown";
        if (!byCap[cap]) byCap[cap] = { revenue: 0, apiCost: 0, count: 0 };
        byCap[cap].revenue += Number(j.cost);
        byCap[cap].apiCost += Number(j.provider_cost);
        byCap[cap].count++;
      }
      economics = {
        totalRevenue,
        totalApiCost,
        marginPct: totalRevenue > 0 ? ((totalRevenue - totalApiCost) / totalRevenue) * 100 : 0,
        count: costJobs.length,
        byCap,
      };
    }

    if (arenaMatches && arenaMatches.length > 0) {
      let wins = 0, losses = 0, ties = 0;
      for (const m of arenaMatches) {
        const side = m.agent_a_id === agent.id ? "a" : "b";
        if (m.winner === "tie") ties++;
        else if (m.winner === side) wins++;
        else losses++;
      }
      const total = wins + losses + ties;
      arenaStats = {
        totalMatches: total,
        wins,
        losses,
        ties,
        winRate: total > 0 ? wins / total : 0,
        elo: bestRating?.elo as number | null ?? null,
      };
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: agent.name,
            description: agent.description,
            applicationCategory: "AI Agent",
            operatingSystem: "Cloud",
            url: `https://www.signalpot.dev/agents/${agent.slug}`,
            ...(agent.rate_amount
              ? {
                  offers: {
                    "@type": "Offer",
                    price: agent.rate_amount.toString(),
                    priceCurrency: "USD",
                  },
                }
              : {}),
          }).replace(/</g, "\\u003c"),
        }}
      />
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
          <AuthButton />
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">{agent.name}</h1>
              {healthStatus !== "unknown" && (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                  healthStatus === "healthy" ? "bg-emerald-950/50 text-emerald-400 border border-emerald-800/50" :
                  healthStatus === "warning" ? "bg-yellow-950/50 text-yellow-400 border border-yellow-800/50" :
                  healthStatus === "degrading" ? "bg-red-950/50 text-red-400 border border-red-800/50" :
                  "bg-gray-900/50 text-gray-500 border border-gray-800/50"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    healthStatus === "healthy" ? "bg-emerald-400" :
                    healthStatus === "warning" ? "bg-yellow-400" :
                    healthStatus === "degrading" ? "bg-red-400" :
                    "bg-gray-500"
                  }`} />
                  {healthStatus === "healthy" ? "Healthy" :
                   healthStatus === "warning" ? "Warning" :
                   healthStatus === "degrading" ? "Degrading" : "Unknown"}
                  {healthScore != null && ` ${Math.round(healthScore * 100)}%`}
                </span>
              )}
              {activeDrifts.length > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-950/50 text-red-400 border border-red-800/50">
                  {activeDrifts.length} drift alert{activeDrifts.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-sm font-mono text-gray-500 mt-0.5">/{agent.slug}</p>
            <p className="text-gray-400 mt-2">{agent.description}</p>
            <div className="flex gap-2 mt-3 flex-wrap">
              <Badge
                variant="status"
                status={agent.status as "active" | "inactive" | "deprecated"}
              >
                {agent.status}
              </Badge>
              {agent.tags?.map((tag: string) => (
                <Badge key={tag} variant="tag">{tag}</Badge>
              ))}
            </div>
          </div>
          {isOwner && (
            <a
              href={`/agents/${agent.slug}/edit`}
              className="px-3 py-1.5 text-xs bg-[#111118] text-gray-300 rounded-lg hover:bg-[#1f2028] border border-[#1f2028] hover:border-[#2d3044] transition-colors"
            >
              Edit
            </a>
          )}
        </div>

        {(agent.goal || agent.decision_logic) && (
          <div className="mb-6 space-y-3">
            {agent.goal && (
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Goal</div>
                <p className="text-sm text-gray-200">{agent.goal}</p>
              </div>
            )}
            {agent.decision_logic && (
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Decision Logic</div>
                <p className="text-sm text-gray-300 whitespace-pre-line">{agent.decision_logic}</p>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg border-l-2 border-l-cyan-400">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Pricing</div>
            <div className="text-lg font-semibold font-mono">
              {agent.rate_amount > 0
                ? `$${agent.rate_amount} / ${agent.rate_type.replace("per_", "")}`
                : "Free"}
            </div>
          </div>
          <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg border-l-2 border-l-cyan-400">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Avg Latency</div>
            <div className="text-lg font-semibold font-mono">
              {agent.avg_latency_ms ?? "—"}ms
            </div>
          </div>
          <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg border-l-2 border-l-cyan-400">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Uptime</div>
            <div className="text-lg font-semibold font-mono">
              {agent.uptime_pct ?? "—"}%
            </div>
          </div>
        </div>

        {agent.mcp_endpoint && (
          <div className="mb-8 p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">
              MCP Endpoint
            </div>
            <code className="text-sm text-cyan-400 font-mono break-all">
              {agent.mcp_endpoint}
            </code>
            <div className="mt-2">
              <a
                href={`/api/agents/${agent.slug}/mcp`}
                className="text-xs text-gray-500 hover:text-gray-300 underline transition-colors"
              >
                View MCP spec (JSON)
              </a>
            </div>
          </div>
        )}

        {capabilities.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Capabilities</h2>
            <div className="space-y-3">
              {capabilities.map(
                (
                  cap: { name: string; description: string },
                  i: number
                ) => (
                  <div
                    key={i}
                    className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg border-l-2 border-l-cyan-800"
                  >
                    <h3 className="font-medium font-mono text-cyan-400">{cap.name}</h3>
                    <p className="text-sm text-gray-400 mt-1">
                      {cap.description}
                    </p>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {capabilities.length > 0 && agent.mcp_endpoint && (
          <AgentPlayground
            agentSlug={agent.slug}
            capabilities={capabilities}
            rateAmount={Number(agent.rate_amount) || 0}
          />
        )}

        {isOwner && economics && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Economics</h2>
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Tracked Calls</p>
                <p className="text-lg font-bold">{economics.count}</p>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Revenue</p>
                <p className="text-lg font-bold text-cyan-400">${economics.totalRevenue.toFixed(4)}</p>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">API Costs</p>
                <p className="text-lg font-bold text-orange-400">${economics.totalApiCost.toFixed(4)}</p>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Net Margin</p>
                <p className={`text-lg font-bold ${economics.marginPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {economics.marginPct.toFixed(1)}%
                </p>
              </div>
            </div>
            {Object.keys(economics.byCap).length > 1 && (
              <div className="space-y-2">
                {Object.entries(economics.byCap).map(([cap, stats]) => {
                  const m = stats.revenue > 0 ? ((stats.revenue - stats.apiCost) / stats.revenue) * 100 : 0;
                  return (
                    <div key={cap} className="flex items-center justify-between p-3 bg-[#111118] border border-[#1f2028] rounded-lg text-sm">
                      <span className="font-mono text-xs text-gray-500">{cap}</span>
                      <div className="flex items-center gap-4">
                        <span className="text-gray-400">{stats.count} calls</span>
                        <span className="text-gray-400">rev <span className="text-cyan-400">${stats.revenue.toFixed(4)}</span></span>
                        <span className="text-gray-400">cost <span className="text-orange-400">${stats.apiCost.toFixed(6)}</span></span>
                        <span className={`font-mono ${m >= 0 ? "text-green-400" : "text-red-400"}`}>{m.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-gray-600 mt-2">Self-reported by agent. Only you can see this.</p>
          </div>
        )}

        {isOwner && arenaStats && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Arena & Training</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Matches</p>
                <p className="text-lg font-bold">{arenaStats.totalMatches}</p>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Win Rate</p>
                <p className={`text-lg font-bold ${arenaStats.winRate >= 0.5 ? "text-emerald-400" : "text-red-400"}`}>
                  {Math.round(arenaStats.winRate * 100)}%
                </p>
                <p className="text-[10px] text-gray-600">{arenaStats.wins}W / {arenaStats.losses}L / {arenaStats.ties}T</p>
              </div>
              {arenaStats.elo != null && (
                <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Best ELO</p>
                  <p className="text-lg font-bold text-cyan-400">{arenaStats.elo}</p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <a
                href={`/arena/training/${agent.slug}/extract`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#111118] border border-purple-800/50 text-purple-400 font-semibold rounded-lg hover:bg-purple-950/30 hover:border-purple-700/50 transition-colors text-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Full Extract Report
              </a>
              <a
                href={`/arena/training/${agent.slug}`}
                className="inline-flex items-center gap-2 px-4 py-2 border border-[#1f2028] text-gray-400 rounded-lg hover:border-[#2d3044] hover:text-gray-300 transition-colors text-sm"
              >
                Training Report
              </a>
              <a
                href={`/arena/new?agent_a=${agent.slug}&agent_b=sparring-partner`}
                className="inline-flex items-center gap-2 px-4 py-2 border border-[#1f2028] text-gray-400 rounded-lg hover:border-[#2d3044] hover:text-gray-300 transition-colors text-sm"
              >
                Start Training
              </a>
            </div>
            <p className="text-xs text-gray-600 mt-2">Only you can see this.</p>
          </div>
        )}

        {isOwner && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Tracking Beacon</h2>
            <div className="p-5 bg-[#111118] border border-[#1f2028] rounded-lg">
              <p className="text-sm text-gray-400 mb-3">
                Track external usage to build trust and rank higher in discovery.
                Add this after each agent call — replace <code className="text-cyan-400">YOUR_API_KEY</code> with
                your key from <a href="/dashboard/keykeeper" className="text-cyan-400 hover:underline">KeyKeeper</a>.
              </p>
              <pre className="p-3 bg-[#0d0d14] border border-[#1f2028] rounded text-xs text-gray-300 overflow-x-auto whitespace-pre">{`fetch("https://signalpot.dev/api/track", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    agent: "${agent.slug}",
    event: "call_completed",
    capability: "...",
    duration_ms: elapsed,
    api_cost: 0.003,
    success: true
  })
});`}</pre>
              <div className="flex items-center gap-3 mt-3 text-xs">
                <span className="text-gray-600">Platform calls are tracked automatically.</span>
                <span className="text-gray-600">|</span>
                <span className="text-gray-500">Calls: <span className="text-white">{(agent.total_external_calls as number) ?? 0}</span> external tracked</span>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-2">Only you can see this.</p>
          </div>
        )}

        {coachingTips.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Performance Coach</h2>
            <div className="space-y-3">
              {coachingTips.map((tip: {
                id: string;
                category: string;
                tip: string;
                metric_name: string | null;
                current_value: number | null;
                baseline_value: number | null;
                created_at: string;
              }) => (
                <div
                  key={tip.id}
                  className={`p-4 bg-[#111118] border rounded-lg border-l-2 ${
                    tip.category === "accuracy" ? "border-[#1f2028] border-l-orange-500" :
                    tip.category === "speed" ? "border-[#1f2028] border-l-yellow-500" :
                    tip.category === "cost" ? "border-[#1f2028] border-l-cyan-500" :
                    tip.category === "schema" ? "border-[#1f2028] border-l-red-500" :
                    tip.category === "coherence" ? "border-[#1f2028] border-l-purple-500" :
                    "border-[#1f2028] border-l-gray-500"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-mono uppercase tracking-widest ${
                      tip.category === "accuracy" ? "text-orange-400" :
                      tip.category === "speed" ? "text-yellow-400" :
                      tip.category === "cost" ? "text-cyan-400" :
                      tip.category === "schema" ? "text-red-400" :
                      tip.category === "coherence" ? "text-purple-400" :
                      "text-gray-400"
                    }`}>
                      {tip.category}
                    </span>
                    <span className="text-[10px] text-gray-600">
                      {new Date(tip.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300">{tip.tip}</p>
                  {tip.current_value != null && tip.baseline_value != null && tip.metric_name !== "schema_compliance" && (
                    <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                      <span>Current: <span className="text-white font-mono">{typeof tip.current_value === "number" && tip.current_value < 10 ? `${(tip.current_value * 100).toFixed(0)}%` : tip.current_value.toLocaleString()}</span></span>
                      <span>Baseline: <span className="text-gray-400 font-mono">{typeof tip.baseline_value === "number" && tip.baseline_value < 10 ? `${(tip.baseline_value * 100).toFixed(0)}%` : tip.baseline_value.toLocaleString()}</span></span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {healthEvents.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Health Timeline</h2>
            <div className="relative">
              <div className="absolute left-3 top-0 bottom-0 w-px bg-[#1f2028]" />
              <div className="space-y-4">
                {healthEvents.map((event: {
                  id: string;
                  event_type: string;
                  severity: string;
                  message: string | null;
                  detected_at: string;
                  resolved_at: string | null;
                }) => (
                  <div key={event.id} className="relative pl-8">
                    <div className={`absolute left-1.5 top-1.5 w-3 h-3 rounded-full border-2 ${
                      event.event_type === "drift_detected" && !event.resolved_at
                        ? event.severity === "critical" ? "bg-red-500 border-red-400" : "bg-yellow-500 border-yellow-400"
                        : event.event_type === "recovery" ? "bg-emerald-500 border-emerald-400"
                        : event.event_type === "drift_detected" && event.resolved_at ? "bg-gray-600 border-gray-500"
                        : "bg-gray-600 border-gray-500"
                    }`} />
                    <div className="p-3 bg-[#111118] border border-[#1f2028] rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-medium ${
                          event.event_type === "drift_detected" && !event.resolved_at
                            ? event.severity === "critical" ? "text-red-400" : "text-yellow-400"
                            : event.event_type === "recovery" ? "text-emerald-400"
                            : "text-gray-500"
                        }`}>
                          {event.event_type === "drift_detected" ? `Drift Detected (${event.severity})` :
                           event.event_type === "recovery" ? "Recovered" :
                           event.event_type === "degradation" ? "Degradation" :
                           event.event_type === "model_change" ? "Model Changed" :
                           event.event_type}
                          {event.resolved_at && event.event_type === "drift_detected" && (
                            <span className="text-gray-600 ml-2">(resolved)</span>
                          )}
                        </span>
                        <span className="text-[10px] text-gray-600">
                          {new Date(event.detected_at).toLocaleDateString()} {new Date(event.detected_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      {event.message && (
                        <p className="text-sm text-gray-400">{event.message}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Trust Graph</h2>
          {(incoming?.length ?? 0) === 0 && (outgoing?.length ?? 0) === 0 ? (
            <p className="text-gray-500">
              No trust relationships yet. Complete jobs to build trust.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-medium text-gray-400 mb-2">
                  Trusted by ({incoming?.length ?? 0} agents)
                </h3>
                <div className="space-y-2">
                  {incoming?.map(
                    (edge: {
                      id: string;
                      trust_score: number;
                      total_jobs: number;
                      source_agent: { name: string; slug: string };
                    }) => (
                      <a
                        key={edge.id}
                        href={`/agents/${edge.source_agent.slug}`}
                        className="flex items-center justify-between p-3 bg-[#111118] border border-[#1f2028] rounded hover:border-[#2d3044] transition-colors"
                      >
                        <span className="text-sm">
                          {edge.source_agent.name}
                        </span>
                        <span className="text-xs text-cyan-400 font-mono">
                          {edge.trust_score.toFixed(2)} ({edge.total_jobs} jobs)
                        </span>
                      </a>
                    )
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-400 mb-2">
                  Trusts ({outgoing?.length ?? 0} agents)
                </h3>
                <div className="space-y-2">
                  {outgoing?.map(
                    (edge: {
                      id: string;
                      trust_score: number;
                      total_jobs: number;
                      target_agent: { name: string; slug: string };
                    }) => (
                      <a
                        key={edge.id}
                        href={`/agents/${edge.target_agent.slug}`}
                        className="flex items-center justify-between p-3 bg-[#111118] border border-[#1f2028] rounded hover:border-[#2d3044] transition-colors"
                      >
                        <span className="text-sm">
                          {edge.target_agent.name}
                        </span>
                        <span className="text-xs text-cyan-400 font-mono">
                          {edge.trust_score.toFixed(2)} ({edge.total_jobs} jobs)
                        </span>
                      </a>
                    )
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {agent.profiles && (
          <div className="text-sm text-gray-600">
            Registered by{" "}
            <span className="text-gray-400">
              {agent.profiles.display_name ??
                agent.profiles.github_username ??
                "Unknown"}
            </span>
          </div>
        )}
      </main>
    </div>
  );
}
