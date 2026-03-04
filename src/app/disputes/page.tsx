import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AuthButton from "@/components/AuthButton";
import { createAdminClient } from "@/lib/supabase/admin";

type DisputeStatus = "open" | "reviewing" | "resolved" | "appealed";
type DisputeResolution = "upheld" | "rejected" | "partial" | null;

interface DisputeRow {
  id: string;
  job_id: string;
  reason: string;
  status: DisputeStatus;
  resolution: DisputeResolution;
  filed_at: string;
  resolved_at: string | null;
  tier: number;
}

function statusBadge(status: DisputeStatus, resolution: DisputeResolution) {
  if (status === "resolved") {
    if (resolution === "upheld")
      return (
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
          resolved — upheld
        </span>
      );
    if (resolution === "rejected")
      return (
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
          resolved — rejected
        </span>
      );
    if (resolution === "partial")
      return (
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30">
          resolved — partial
        </span>
      );
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-500/20 text-gray-400 border border-gray-500/30">
        resolved
      </span>
    );
  }
  if (status === "open")
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
        open
      </span>
    );
  if (status === "reviewing")
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
        reviewing
      </span>
    );
  if (status === "appealed")
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30">
        appealed
      </span>
    );
  return null;
}

export default async function DisputesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: disputes } = await admin
    .from("disputes")
    .select("id, job_id, reason, status, resolution, filed_at, resolved_at, tier")
    .eq("filed_by_profile_id", user.id)
    .order("filed_at", { ascending: false });

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[#1f2028] bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-10">
        <a href="/" className="text-xl font-bold tracking-tight">
          Signal<span className="text-cyan-400">Pot</span>
        </a>
        <div className="flex items-center gap-6">
          <a
            href="/dashboard"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Dashboard
          </a>
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
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">My Disputes</h1>
            <p className="text-sm text-gray-500 mt-1">
              Track disputes you&apos;ve filed against agent providers
            </p>
          </div>
        </div>

        {!disputes || disputes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-4xl mb-4">⚖️</div>
            <h2 className="text-lg font-semibold text-gray-300 mb-2">
              No disputes filed
            </h2>
            <p className="text-sm text-gray-500 max-w-sm">
              If you have an issue with a completed job, you can file a dispute
              from your{" "}
              <a href="/dashboard" className="text-cyan-400 hover:underline">
                dashboard
              </a>{" "}
              within 72 hours of completion.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {(disputes as DisputeRow[]).map((dispute) => (
              <a
                key={dispute.id}
                href={`/disputes/${dispute.id}`}
                className="flex items-center justify-between p-4 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-xs font-mono text-gray-600 shrink-0">
                      Job {dispute.job_id.slice(0, 8)}…
                    </span>
                    {statusBadge(dispute.status, dispute.resolution)}
                    <span className="text-xs text-gray-600">
                      Tier {dispute.tier}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300 truncate">
                    {dispute.reason.length > 60
                      ? dispute.reason.slice(0, 60) + "…"
                      : dispute.reason}
                  </p>
                </div>
                <div className="flex items-center gap-4 ml-4 shrink-0">
                  <span className="text-xs text-gray-600">
                    {new Date(dispute.filed_at).toLocaleDateString()}
                  </span>
                  <span className="text-gray-600 group-hover:text-gray-400 transition-colors">
                    →
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
