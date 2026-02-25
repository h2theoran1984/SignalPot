import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import AuthButton from "@/components/AuthButton";

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
      .order("trust_score", { ascending: false })
      .limit(10),
    supabase
      .from("trust_edges")
      .select(
        "*, target_agent:agents!trust_edges_target_agent_id_fkey(name, slug)"
      )
      .eq("source_agent_id", agent.id)
      .order("trust_score", { ascending: false })
      .limit(10),
  ]);

  const capabilities = Array.isArray(agent.capability_schema)
    ? agent.capability_schema
    : [];

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

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">{agent.name}</h1>
            <p className="text-gray-400 mt-1">{agent.description}</p>
            <div className="flex gap-2 mt-3">
              {agent.tags?.map((tag: string) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 text-xs bg-gray-800 border border-gray-700 rounded-full text-gray-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isOwner && (
              <a
                href={`/agents/${agent.slug}/edit`}
                className="px-3 py-1 text-xs bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 border border-gray-700 transition-colors"
              >
                Edit
              </a>
            )}
            <span
              className={`px-2 py-1 rounded text-xs ${agent.status === "active" ? "bg-green-900/50 text-green-400" : "bg-gray-800 text-gray-400"}`}
            >
              {agent.status}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="p-4 bg-gray-900 border border-gray-800 rounded-lg">
            <div className="text-xs text-gray-500 uppercase">Pricing</div>
            <div className="text-lg font-semibold mt-1">
              {agent.rate_amount > 0
                ? `$${agent.rate_amount} / ${agent.rate_type.replace("per_", "")}`
                : "Free"}
            </div>
          </div>
          <div className="p-4 bg-gray-900 border border-gray-800 rounded-lg">
            <div className="text-xs text-gray-500 uppercase">Avg Latency</div>
            <div className="text-lg font-semibold mt-1">
              {agent.avg_latency_ms}ms
            </div>
          </div>
          <div className="p-4 bg-gray-900 border border-gray-800 rounded-lg">
            <div className="text-xs text-gray-500 uppercase">Uptime</div>
            <div className="text-lg font-semibold mt-1">
              {agent.uptime_pct}%
            </div>
          </div>
        </div>

        {agent.mcp_endpoint && (
          <div className="mb-8 p-4 bg-gray-900 border border-gray-800 rounded-lg">
            <div className="text-xs text-gray-500 uppercase mb-1">
              MCP Endpoint
            </div>
            <code className="text-sm text-green-400">
              {agent.mcp_endpoint}
            </code>
            <div className="mt-2">
              <a
                href={`/api/agents/${agent.slug}/mcp`}
                className="text-xs text-gray-400 hover:text-white underline"
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
                    className="p-4 bg-gray-900 border border-gray-800 rounded-lg"
                  >
                    <h3 className="font-medium">{cap.name}</h3>
                    <p className="text-sm text-gray-400 mt-1">
                      {cap.description}
                    </p>
                  </div>
                )
              )}
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
                        className="flex items-center justify-between p-3 bg-gray-900 border border-gray-800 rounded hover:border-gray-600 transition-colors"
                      >
                        <span className="text-sm">
                          {edge.source_agent.name}
                        </span>
                        <span className="text-xs text-green-400">
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
                        className="flex items-center justify-between p-3 bg-gray-900 border border-gray-800 rounded hover:border-gray-600 transition-colors"
                      >
                        <span className="text-sm">
                          {edge.target_agent.name}
                        </span>
                        <span className="text-xs text-green-400">
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
          <div className="text-sm text-gray-500">
            Registered by{" "}
            <span className="text-gray-300">
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
