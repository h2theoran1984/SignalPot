import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SiteNav from "@/components/SiteNav";
import BillingSection from "@/components/BillingSection";
import ApiKeysSection from "@/components/ApiKeysSection";
import { getAgentLimitForPlan, type Plan } from "@/lib/plans";
import { Badge } from "@/components/ui/badge";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { data: agents, count: agentCount } = await supabase
    .from("agents")
    .select("*", { count: "exact" })
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  const plan = ((profile?.plan as Plan) ?? "free") as Plan;
  const agentLimit = getAgentLimitForPlan(plan);
  const usedAgents = agentCount ?? agents?.length ?? 0;

  const { data: jobs } = await supabase
    .from("jobs")
    .select("*, provider_agent:agents!jobs_provider_agent_id_fkey(name, slug)")
    .eq("requester_profile_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  // Fetch provider-side jobs (where user's agents served requests) with cost data
  const agentIds = (agents ?? []).map((a) => a.id);
  const { data: providerJobs } = agentIds.length > 0
    ? await supabase
        .from("jobs")
        .select("id, cost, provider_cost, capability_used, provider_agent_id, created_at, status, provider_agent:agents!jobs_provider_agent_id_fkey(name)")
        .in("provider_agent_id", agentIds)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: null };

  // Compute aggregate economics
  const economicsJobs = (providerJobs ?? []).filter((j) => j.provider_cost != null);
  const totalRevenue = economicsJobs.reduce((sum, j) => sum + Number(j.cost), 0);
  const totalApiCost = economicsJobs.reduce((sum, j) => sum + Number(j.provider_cost), 0);
  const totalMargin = totalRevenue - totalApiCost;
  const marginPct = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-8">
          {profile?.avatar_url && (
            <img
              src={profile.avatar_url}
              alt=""
              className="w-12 h-12 rounded-full ring-2 ring-[#1f2028]"
            />
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

        {/* KeyKeeper */}
        <a
          href="/dashboard/keykeeper"
          className="flex items-center gap-4 p-4 mb-6 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors group"
        >
          <div className="w-10 h-10 rounded-lg bg-cyan-400/10 flex items-center justify-center text-lg shrink-0">
            🔐
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm group-hover:text-cyan-400 transition-colors">
              KeyKeeper
            </h3>
            <p className="text-xs text-gray-500">
              Manage encrypted API keys and secrets with auto-rotation
            </p>
          </div>
          <span className="text-xs text-gray-600 group-hover:text-gray-400 transition-colors">
            Open →
          </span>
        </a>

        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">My Agents</h2>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-32 h-1.5 bg-[#1f2028] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    usedAgents >= agentLimit
                      ? "bg-red-500"
                      : usedAgents >= agentLimit * 0.8
                        ? "bg-yellow-500"
                        : "bg-cyan-400"
                  }`}
                  style={{ width: `${Math.min(100, (usedAgents / agentLimit) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-gray-500">
                {usedAgents} / {agentLimit} agents
                {usedAgents >= agentLimit && (
                  <a href="/pricing" className="ml-1 text-cyan-400 hover:underline">
                    — upgrade
                  </a>
                )}
              </span>
            </div>
          </div>
          <a
            href="/agents/new"
            className="px-4 py-2 bg-cyan-400 text-gray-950 rounded-lg hover:bg-cyan-300 transition-colors text-sm font-semibold"
          >
            Register Agent
          </a>
        </div>

        {!agents || agents.length === 0 ? (
          <p className="text-gray-500 mb-8">
            You haven&apos;t registered any agents yet.{" "}
            <a href="/agents/new" className="text-cyan-400 hover:underline">
              Register your first agent
            </a>
          </p>
        ) : (
          <div className="grid gap-3 mb-8">
            {agents.map((agent) => (
              <a
                key={agent.id}
                href={`/agents/${agent.slug}`}
                className="flex items-center justify-between p-4 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors"
              >
                <div>
                  <span className="font-medium">{agent.name}</span>
                  <span className="text-gray-600 ml-2 text-sm font-mono">
                    /{agent.slug}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {agent.arena_eligible === false && (
                    <Badge variant="tag" className="text-[10px] opacity-60">
                      No Arena
                    </Badge>
                  )}
                  <Badge
                    variant="status"
                    status={agent.status as "active" | "inactive" | "deprecated"}
                  >
                    {agent.status}
                  </Badge>
                </div>
              </a>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Recent Jobs</h2>
          <div className="flex items-center gap-4">
            <a
              href="/dashboard/statements"
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Statements →
            </a>
            <a
              href="/disputes"
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              My Disputes →
            </a>
          </div>
        </div>
        {!jobs || jobs.length === 0 ? (
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
                    <span className="font-mono text-xs text-gray-500">{job.capability_used ?? "job"}</span>{" "}
                    via{" "}
                    <a
                      href={`/agents/${job.provider_agent?.slug}`}
                      className="text-white hover:text-cyan-400 transition-colors"
                    >
                      {job.provider_agent?.name}
                    </a>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant="status"
                    status={job.status as "pending" | "running" | "completed" | "failed"}
                  >
                    {job.status}
                  </Badge>
                  {job.duration_ms && (
                    <span className="text-xs text-gray-600 font-mono">{job.duration_ms}ms</span>
                  )}
                  {job.cost > 0 && (
                    <span className="text-xs text-gray-500">${job.cost}</span>
                  )}
                  {job.status === "completed" && (
                    <a
                      href={`/disputes/new?job_id=${job.id}`}
                      className="text-xs text-gray-600 hover:text-yellow-400 transition-colors border border-transparent hover:border-yellow-400/30 px-1.5 py-0.5 rounded"
                      title="File a dispute for this job"
                    >
                      dispute
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {agentIds.length > 0 && economicsJobs.length > 0 && (
          <>
            <h2 className="text-xl font-semibold mt-10 mb-4">Agent Economics</h2>
            <div className="grid grid-cols-4 gap-3 mb-4">
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
            <div className="space-y-2">
              {economicsJobs.slice(0, 10).map((j) => {
                const rev = Number(j.cost);
                const api = Number(j.provider_cost);
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
          </>
        )}
      </main>
    </div>
  );
}
