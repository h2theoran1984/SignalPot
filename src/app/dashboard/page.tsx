import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AuthButton from "@/components/AuthButton";

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

  const { data: agents } = await supabase
    .from("agents")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  const { data: jobs } = await supabase
    .from("jobs")
    .select("*, provider_agent:agents!jobs_provider_agent_id_fkey(name, slug)")
    .eq("requester_profile_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

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

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-8">
          {profile?.avatar_url && (
            <img
              src={profile.avatar_url}
              alt=""
              className="w-12 h-12 rounded-full"
            />
          )}
          <div>
            <h1 className="text-2xl font-bold">
              {profile?.display_name ?? profile?.github_username ?? "Dashboard"}
            </h1>
            <p className="text-sm text-gray-400">{profile?.email}</p>
          </div>
        </div>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">My Agents</h2>
          <a
            href="/agents/new"
            className="px-4 py-2 bg-white text-gray-900 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
          >
            Register Agent
          </a>
        </div>

        {!agents || agents.length === 0 ? (
          <p className="text-gray-500 mb-8">
            You haven&apos;t registered any agents yet.{" "}
            <a href="/agents/new" className="text-white underline">
              Register your first agent
            </a>
          </p>
        ) : (
          <div className="grid gap-3 mb-8">
            {agents.map((agent) => (
              <a
                key={agent.id}
                href={`/agents/${agent.slug}`}
                className="flex items-center justify-between p-4 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-600 transition-colors"
              >
                <div>
                  <span className="font-medium">{agent.name}</span>
                  <span className="text-gray-500 ml-2 text-sm">
                    /{agent.slug}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 text-xs rounded ${agent.status === "active" ? "bg-green-900/50 text-green-400" : "bg-gray-800 text-gray-400"}`}
                >
                  {agent.status}
                </span>
              </a>
            ))}
          </div>
        )}

        <h2 className="text-xl font-semibold mb-4">Recent Jobs</h2>
        {!jobs || jobs.length === 0 ? (
          <p className="text-gray-500">No job history yet.</p>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between p-4 bg-gray-900 border border-gray-800 rounded-lg"
              >
                <div>
                  <span className="text-sm">
                    {job.capability_used ?? "Job"} via{" "}
                    <a
                      href={`/agents/${job.provider_agent?.slug}`}
                      className="text-white underline"
                    >
                      {job.provider_agent?.name}
                    </a>
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span
                    className={`px-2 py-0.5 text-xs rounded ${
                      job.status === "completed"
                        ? "bg-green-900/50 text-green-400"
                        : job.status === "failed"
                          ? "bg-red-900/50 text-red-400"
                          : "bg-yellow-900/50 text-yellow-400"
                    }`}
                  >
                    {job.status}
                  </span>
                  {job.duration_ms && (
                    <span className="text-gray-500">{job.duration_ms}ms</span>
                  )}
                  {job.cost > 0 && (
                    <span className="text-gray-400">${job.cost}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
