"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "@/components/SiteNav";
import BillingSection from "@/components/BillingSection";
import ApiKeysSection from "@/components/ApiKeysSection";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Profile {
  display_name: string | null;
  github_username: string | null;
  email: string | null;
  avatar_url: string | null;
  plan: string;
  credit_balance_millicents: number;
}

interface Agent {
  id: string;
  name: string;
  slug: string;
  status: string;
  arena_eligible: boolean;
  rate_amount: number;
  created_at: string;
}

interface Job {
  id: string;
  capability_used: string | null;
  status: string;
  cost: number;
  provider_cost: number | null;
  duration_ms: number | null;
  created_at: string;
  provider_agent: { name: string; slug: string } | null;
  // For categorization
  job_type?: string;
}

type DashTab = "inventory" | "jobs" | "economics";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<DashTab>("inventory");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [providerJobs, setProviderJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      // Profile
      const { data: profileData } = await supabase
        .from("profiles")
        .select("display_name, github_username, email, avatar_url, plan, credit_balance_millicents")
        .eq("id", user.id)
        .single();
      if (profileData) setProfile(profileData as Profile);

      // My agents
      const { data: agentsData } = await supabase
        .from("agents")
        .select("id, name, slug, status, arena_eligible, rate_amount, created_at")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false });
      setAgents((agentsData ?? []) as Agent[]);

      // Jobs I requested
      const { data: jobsData } = await supabase
        .from("jobs")
        .select("id, capability_used, status, cost, provider_cost, duration_ms, created_at, job_type, provider_agent:agents!jobs_provider_agent_id_fkey(name, slug)")
        .eq("requester_profile_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      setJobs((jobsData ?? []) as unknown as Job[]);

      // Provider-side jobs (where my agents served requests)
      const agentIds = (agentsData ?? []).map((a) => a.id);
      if (agentIds.length > 0) {
        const { data: provData } = await supabase
          .from("jobs")
          .select("id, cost, provider_cost, capability_used, provider_agent_id, created_at, status, job_type, provider_agent:agents!jobs_provider_agent_id_fkey(name)")
          .in("provider_agent_id", agentIds)
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(50);
        setProviderJobs((provData ?? []) as unknown as Job[]);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Economics calculations
  const economicsJobs = providerJobs.filter((j) => j.provider_cost != null);
  const totalRevenue = economicsJobs.reduce((sum, j) => sum + Number(j.cost), 0);
  const totalApiCost = economicsJobs.reduce((sum, j) => sum + Number(j.provider_cost ?? 0), 0);
  const totalMargin = totalRevenue - totalApiCost;
  const marginPct = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0;

  // Split economics by type (arena vs regular jobs)
  const arenaJobs = economicsJobs.filter((j) => j.job_type === "arena" || (j.capability_used && ["analyze", "summarize", "search"].includes(j.capability_used)));
  const regularJobs = economicsJobs.filter((j) => !arenaJobs.includes(j));

  const arenaRevenue = arenaJobs.reduce((s, j) => s + Number(j.cost), 0);
  const arenaCost = arenaJobs.reduce((s, j) => s + Number(j.provider_cost ?? 0), 0);
  const regularRevenue = regularJobs.reduce((s, j) => s + Number(j.cost), 0);
  const regularCost = regularJobs.reduce((s, j) => s + Number(j.provider_cost ?? 0), 0);

  const plan = (profile?.plan ?? "free") as string;

  const tabs: { key: DashTab; label: string }[] = [
    { key: "inventory", label: "Inventory" },
    { key: "jobs", label: "Jobs" },
    { key: "economics", label: "Economics" },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white">
        <SiteNav />
        <main className="max-w-5xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-12 bg-[#111118] rounded w-1/3" />
            <div className="h-64 bg-[#111118] rounded" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          {profile?.avatar_url && (
            <img src={profile.avatar_url} alt="" className="w-12 h-12 rounded-full ring-2 ring-[#1f2028]" />
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">
                {profile?.display_name ?? profile?.github_username ?? "Dashboard"}
              </h1>
              <Badge variant="plan">{plan}</Badge>
            </div>
            <p className="text-sm text-gray-500">{profile?.email}</p>
          </div>
        </div>

        <BillingSection
          plan={profile?.plan ?? "free"}
          creditBalanceMillicents={profile?.credit_balance_millicents ?? 0}
        />

        <ApiKeysSection />

        {/* KeyKeeper link */}
        <a
          href="/dashboard/keykeeper"
          className="flex items-center gap-4 p-4 mb-6 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors group"
        >
          <div className="w-10 h-10 rounded-lg bg-cyan-400/10 flex items-center justify-center text-lg shrink-0">
            🔐
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm group-hover:text-cyan-400 transition-colors">KeyKeeper</h3>
            <p className="text-xs text-gray-500">Manage encrypted API keys and secrets with auto-rotation</p>
          </div>
          <span className="text-xs text-gray-600 group-hover:text-gray-400 transition-colors">Open →</span>
        </a>

        {/* Tab bar */}
        <div className="flex items-center gap-1 mb-6 border-b border-[#1f2028]">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t.key
                  ? "text-white border-cyan-400"
                  : "text-gray-500 border-transparent hover:text-gray-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ================================================================= */}
        {/* INVENTORY TAB                                                      */}
        {/* ================================================================= */}
        {tab === "inventory" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold">My Agents</h2>
                <p className="text-xs text-gray-500 mt-1">
                  {agents.length} agent{agents.length !== 1 ? "s" : ""} registered
                </p>
              </div>
              <a
                href="/agents/new"
                className="px-4 py-2 bg-cyan-400 text-gray-950 rounded-lg hover:bg-cyan-300 transition-colors text-sm font-semibold"
              >
                Register Agent
              </a>
            </div>

            {agents.length === 0 ? (
              <p className="text-gray-500 mb-8">
                You haven&apos;t registered any agents yet.{" "}
                <a href="/agents/new" className="text-cyan-400 hover:underline">Register your first agent</a>
              </p>
            ) : (
              <div className="grid gap-3">
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between p-4 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors"
                  >
                    <a href={`/agents/${agent.slug}`} className="flex-1 min-w-0">
                      <span className="font-medium">{agent.name}</span>
                      <span className="text-gray-600 ml-2 text-sm font-mono">/{agent.slug}</span>
                      {agent.rate_amount > 0 && (
                        <span className="text-gray-600 ml-2 text-xs">${agent.rate_amount}/call</span>
                      )}
                    </a>
                    <div className="flex items-center gap-2">
                      {agent.arena_eligible !== false && (
                        <a
                          href={`/arena/training/${agent.slug}/extract`}
                          className="px-2 py-1 text-[10px] font-medium text-purple-400 border border-purple-800/40 rounded hover:bg-purple-950/30 transition-colors"
                          title="Full Extract Report"
                        >
                          Extract
                        </a>
                      )}
                      {agent.arena_eligible === false && (
                        <Badge variant="tag" className="text-[10px] opacity-60">No Arena</Badge>
                      )}
                      <Badge variant="status" status={agent.status as "active" | "inactive"}>
                        {agent.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* JOBS TAB                                                           */}
        {/* ================================================================= */}
        {tab === "jobs" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Recent Jobs</h2>
              <div className="flex items-center gap-4">
                <a href="/dashboard/statements" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                  Statements →
                </a>
                <a href="/disputes" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                  Disputes →
                </a>
              </div>
            </div>

            {jobs.length === 0 ? (
              <p className="text-gray-500">No job history yet.</p>
            ) : (
              <div className="space-y-2">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between p-4 bg-[#111118] border border-[#1f2028] rounded-lg"
                  >
                    <div>
                      <span className="text-sm text-gray-300">
                        <span className="font-mono text-xs text-gray-500">{job.capability_used ?? "job"}</span>
                        {" via "}
                        <a
                          href={`/agents/${job.provider_agent?.slug}`}
                          className="text-white hover:text-cyan-400 transition-colors"
                        >
                          {job.provider_agent?.name ?? "Unknown"}
                        </a>
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="status" status={job.status as "pending" | "running" | "completed" | "failed"}>
                        {job.status}
                      </Badge>
                      {job.duration_ms != null && (
                        <span className="text-xs text-gray-600 font-mono">{job.duration_ms}ms</span>
                      )}
                      {job.cost > 0 && (
                        <span className="text-xs text-gray-500">${job.cost}</span>
                      )}
                      {job.status === "completed" && (
                        <a
                          href={`/disputes/new?job_id=${job.id}`}
                          className="text-xs text-gray-600 hover:text-yellow-400 transition-colors border border-transparent hover:border-yellow-400/30 px-1.5 py-0.5 rounded"
                        >
                          dispute
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* ECONOMICS TAB                                                      */}
        {/* ================================================================= */}
        {tab === "economics" && (
          <div>
            <h2 className="text-xl font-semibold mb-4">Agent Economics</h2>

            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Calls Tracked</p>
                <p className="text-lg font-bold">{economicsJobs.length}</p>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Revenue</p>
                <p className="text-lg font-bold text-cyan-400">${totalRevenue.toFixed(4)}</p>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">API Costs</p>
                <p className="text-lg font-bold text-orange-400">${totalApiCost.toFixed(4)}</p>
              </div>
              <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Net Margin</p>
                <p className={`text-lg font-bold ${marginPct >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {marginPct.toFixed(1)}%
                </p>
              </div>
            </div>

            {/* Breakdown by type */}
            {(arenaJobs.length > 0 || regularJobs.length > 0) && (
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                  <p className="text-xs text-gray-500 mb-2">Arena Matches</p>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">{arenaJobs.length} calls</span>
                    <span className="text-gray-400">
                      rev <span className="text-cyan-400">${arenaRevenue.toFixed(4)}</span>
                      {" · "}cost <span className="text-orange-400">${arenaCost.toFixed(4)}</span>
                    </span>
                  </div>
                </div>
                <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                  <p className="text-xs text-gray-500 mb-2">Regular Jobs</p>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">{regularJobs.length} calls</span>
                    <span className="text-gray-400">
                      rev <span className="text-cyan-400">${regularRevenue.toFixed(4)}</span>
                      {" · "}cost <span className="text-orange-400">${regularCost.toFixed(4)}</span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Per-call breakdown */}
            {economicsJobs.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Per-Call Breakdown</h3>
                <div className="space-y-2">
                  {economicsJobs.slice(0, 20).map((j) => {
                    const rev = Number(j.cost);
                    const api = Number(j.provider_cost ?? 0);
                    const m = rev > 0 ? ((rev - api) / rev) * 100 : 0;
                    return (
                      <div
                        key={j.id}
                        className="flex items-center justify-between p-3 bg-[#111118] border border-[#1f2028] rounded-lg text-sm"
                      >
                        <span className="font-mono text-xs text-gray-500">
                          <span className="text-white">{(j.provider_agent as unknown as { name: string } | null)?.name ?? "Agent"}</span>
                          {" · "}
                          {j.capability_used ?? "call"}
                        </span>
                        <div className="flex items-center gap-4">
                          <span className="text-gray-400">rev <span className="text-cyan-400">${rev.toFixed(4)}</span></span>
                          <span className="text-gray-400">cost <span className="text-orange-400">${api.toFixed(6)}</span></span>
                          <span className={`font-mono ${m >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {m.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {economicsJobs.length === 0 && (
              <p className="text-gray-500 text-sm">No economics data yet. Run some agent calls to see cost tracking.</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
