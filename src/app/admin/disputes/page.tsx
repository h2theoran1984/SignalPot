import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import AuthButton from "@/components/AuthButton";

type DisputeStatus = "open" | "reviewing" | "resolved" | "appealed";
type DisputeResolution = "upheld" | "rejected" | "partial" | null;

interface PanelVote {
  id: string;
  agent_id: string;
  vote: "upheld" | "rejected";
  reasoning: string | null;
  voted_at: string;
  agents: {
    name: string;
    slug: string;
  } | null;
}

interface AdminDispute {
  id: string;
  job_id: string;
  reason: string;
  tier: number;
  status: DisputeStatus;
  resolution: DisputeResolution;
  filed_at: string;
  resolved_at: string | null;
  resolver_notes: string | null;
  jobs: {
    id: string;
    status: string;
    rate_amount: number | null;
  } | null;
}

function voteBadge(vote: "upheld" | "rejected") {
  if (vote === "upheld") {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30">
        upheld
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30">
      rejected
    </span>
  );
}

export default async function AdminDisputesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Check is_admin flag
  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) {
    redirect("/dashboard");
  }

  // Fetch all Tier 3 disputes awaiting admin resolution
  const { data: disputes } = await admin
    .from("disputes")
    .select("*, jobs(id, status, rate_amount)")
    .eq("tier", 3)
    .eq("status", "reviewing")
    .order("filed_at", { ascending: true });

  const disputeList = (disputes ?? []) as AdminDispute[];

  // Fetch panel votes for all these disputes
  const disputeIds = disputeList.map((d) => d.id);
  const { data: allVotes } = disputeIds.length > 0
    ? await admin
        .from("dispute_panel_votes")
        .select("*, agents(name, slug)")
        .in("dispute_id", disputeIds)
    : { data: [] };

  const votesByDispute: Record<string, PanelVote[]> = {};
  for (const vote of allVotes ?? []) {
    const v = vote as PanelVote & { dispute_id: string };
    if (!votesByDispute[v.dispute_id]) votesByDispute[v.dispute_id] = [];
    votesByDispute[v.dispute_id].push(v);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[#1f2028] bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-10">
        <a href="/" className="text-xl font-bold tracking-tight">
          Signal<span className="text-cyan-400">Pot</span>
          <span className="ml-2 text-xs font-normal text-orange-400 border border-orange-400/40 rounded px-1.5 py-0.5">
            Admin
          </span>
        </a>
        <div className="flex items-center gap-6">
          <a
            href="/dashboard"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Dashboard
          </a>
          <AuthButton />
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1">
            Tier 3 — Admin Dispute Queue
          </h1>
          <p className="text-sm text-gray-500">
            Disputes escalated past community panel review. Requires platform
            admin resolution.
          </p>
        </div>

        {disputeList.length === 0 ? (
          <div className="text-center py-20 text-gray-600">
            <div className="text-4xl mb-4">&#x2714;</div>
            <p className="text-sm">No Tier 3 disputes awaiting review.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {disputeList.map((d) => {
              const panelVotes = votesByDispute[d.id] ?? [];
              const upheldCount = panelVotes.filter(
                (v) => v.vote === "upheld"
              ).length;
              const rejectedCount = panelVotes.filter(
                (v) => v.vote === "rejected"
              ).length;

              return (
                <div
                  key={d.id}
                  className="bg-[#111118] border border-[#1f2028] rounded-xl overflow-hidden"
                >
                  {/* Dispute header */}
                  <div className="p-5 border-b border-[#1f2028]">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-mono text-gray-600">
                            {d.id.slice(0, 8)}...{d.id.slice(-4)}
                          </span>
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-500/15 text-orange-400 border border-orange-500/30">
                            Tier 3
                          </span>
                        </div>
                        <p className="text-sm text-gray-300 mt-1">{d.reason}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-gray-500">
                          Job:{" "}
                          <span className="font-mono text-gray-400">
                            {d.job_id.slice(0, 8)}
                          </span>
                        </div>
                        {d.jobs?.rate_amount != null && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            ${d.jobs.rate_amount} charged
                          </div>
                        )}
                        <div className="text-xs text-gray-600 mt-1">
                          Filed {new Date(d.filed_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    {/* T1 resolver notes */}
                    {d.resolver_notes && (
                      <div className="mt-3 p-3 bg-[#0d0d14] border border-[#1f2028] rounded-lg border-l-2 border-l-cyan-800">
                        <div className="text-xs text-gray-600 uppercase tracking-widest mb-1">
                          Resolution History
                        </div>
                        <p className="text-xs text-gray-400 whitespace-pre-line">
                          {d.resolver_notes}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Panel votes */}
                  {panelVotes.length > 0 && (
                    <div className="p-5 border-b border-[#1f2028]">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-xs text-gray-500 uppercase tracking-widest">
                          Panel Votes
                        </div>
                        <div className="text-xs font-medium">
                          <span className="text-green-400">{upheldCount} uphold</span>
                          <span className="text-gray-600 mx-1">/</span>
                          <span className="text-red-400">{rejectedCount} reject</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {panelVotes.map((vote) => (
                          <div
                            key={vote.id}
                            className="flex items-start gap-3 text-sm"
                          >
                            <div className="shrink-0 pt-0.5">
                              {voteBadge(vote.vote)}
                            </div>
                            <div>
                              <span className="text-gray-400 text-xs font-medium">
                                {vote.agents?.name ?? "Unknown Agent"}
                              </span>
                              {vote.reasoning && (
                                <span className="text-gray-600 text-xs ml-2">
                                  — {vote.reasoning}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Resolve actions */}
                  <div className="p-5">
                    <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">
                      Admin Resolution
                    </div>
                    <div className="flex items-center gap-3">
                      <form
                        action={`/api/admin/disputes/${d.id}/resolve`}
                        method="POST"
                        className="contents"
                      >
                        <input type="hidden" name="resolution" value="upheld" />
                        <button
                          type="submit"
                          className="px-4 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition-colors"
                        >
                          Uphold
                        </button>
                      </form>
                      <form
                        action={`/api/admin/disputes/${d.id}/resolve`}
                        method="POST"
                        className="contents"
                      >
                        <input type="hidden" name="resolution" value="rejected" />
                        <button
                          type="submit"
                          className="px-4 py-2 rounded-lg text-sm font-medium bg-red-700 hover:bg-red-600 text-white transition-colors"
                        >
                          Reject
                        </button>
                      </form>
                      <form
                        action={`/api/admin/disputes/${d.id}/resolve`}
                        method="POST"
                        className="contents"
                      >
                        <input type="hidden" name="resolution" value="partial" />
                        <button
                          type="submit"
                          className="px-4 py-2 rounded-lg text-sm font-medium bg-[#1f2028] hover:bg-[#2a2b38] text-gray-300 border border-[#2a2b38] transition-colors"
                        >
                          Partial
                        </button>
                      </form>
                    </div>
                    <p className="text-xs text-gray-600 mt-2">
                      This action is final. Deposits will be settled immediately.
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
