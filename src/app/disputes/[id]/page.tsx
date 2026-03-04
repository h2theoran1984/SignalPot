import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import AuthButton from "@/components/AuthButton";
import { createAdminClient } from "@/lib/supabase/admin";

type DisputeStatus = "open" | "reviewing" | "resolved" | "appealed";
type DisputeResolution = "upheld" | "rejected" | "partial" | null;
type DepositStatus = "held" | "returned" | "forfeited";

interface DisputeDeposit {
  id: string;
  profile_id: string;
  amount_millicents: number;
  status: DepositStatus;
  created_at: string;
}

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

interface DisputeDetail {
  id: string;
  job_id: string;
  reason: string;
  evidence: Record<string, unknown> | null;
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
    input_summary: Record<string, unknown> | null;
    output_summary: Record<string, unknown> | null;
  } | null;
  dispute_deposits: DisputeDeposit[];
}

function statusLabel(status: DisputeStatus, resolution: DisputeResolution) {
  if (status === "resolved") {
    if (resolution === "upheld")
      return { label: "Resolved — Upheld", cls: "text-green-400 bg-green-500/10 border-green-500/30" };
    if (resolution === "rejected")
      return { label: "Resolved — Rejected", cls: "text-red-400 bg-red-500/10 border-red-500/30" };
    if (resolution === "partial")
      return { label: "Resolved — Partial", cls: "text-purple-400 bg-purple-500/10 border-purple-500/30" };
    return { label: "Resolved", cls: "text-gray-400 bg-gray-500/10 border-gray-500/30" };
  }
  if (status === "open")
    return { label: "Open", cls: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30" };
  if (status === "reviewing")
    return { label: "Under Review (Tier 2)", cls: "text-blue-400 bg-blue-500/10 border-blue-500/30" };
  if (status === "appealed")
    return { label: "Appealed", cls: "text-orange-400 bg-orange-500/10 border-orange-500/30" };
  return { label: status, cls: "text-gray-400 bg-gray-500/10 border-gray-500/30" };
}

function depositStatusLabel(s: DepositStatus) {
  if (s === "held") return "text-yellow-400";
  if (s === "returned") return "text-green-400";
  if (s === "forfeited") return "text-red-400";
  return "text-gray-400";
}

export default async function DisputeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: dispute, error } = await admin
    .from("disputes")
    .select(
      "*, jobs(id, status, rate_amount, input_summary, output_summary), dispute_deposits(*)"
    )
    .eq("id", id)
    .eq("filed_by_profile_id", user.id)
    .single();

  if (error || !dispute) notFound();

  const d = dispute as DisputeDetail;
  const { label, cls } = statusLabel(d.status, d.resolution);

  // Fetch panel votes if this dispute is Tier 2+
  let panelVotes: PanelVote[] = [];
  if (d.tier >= 2) {
    const { data: votes } = await admin
      .from("dispute_panel_votes")
      .select("*, agents(name, slug)")
      .eq("dispute_id", d.id)
      .order("voted_at", { ascending: true });
    panelVotes = (votes ?? []) as PanelVote[];
  }

  const upheldCount = panelVotes.filter((v) => v.vote === "upheld").length;
  const rejectedCount = panelVotes.filter((v) => v.vote === "rejected").length;

  const inputEnvelope =
    d.evidence?.input_envelope ?? d.jobs?.input_summary?._envelope ?? null;
  const outputEnvelope =
    d.evidence?.output_envelope ?? d.jobs?.output_summary?._envelope ?? null;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[#1f2028] bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-10">
        <a href="/" className="text-xl font-bold tracking-tight">
          Signal<span className="text-cyan-400">Pot</span>
        </a>
        <div className="flex items-center gap-6">
          <a
            href="/disputes"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            My Disputes
          </a>
          <a
            href="/dashboard"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Dashboard
          </a>
          <AuthButton />
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <a
              href="/disputes"
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              ← All disputes
            </a>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold mb-1">Dispute</h1>
              <p className="text-xs font-mono text-gray-600">{d.id}</p>
            </div>
            <span
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${cls}`}
            >
              {label}
            </span>
          </div>
        </div>

        {/* Timeline */}
        <div className="flex items-center gap-4 mb-8 p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
          <div className="text-center">
            <div className="text-xs text-gray-500 mb-1">Filed</div>
            <div className="text-sm font-mono text-gray-300">
              {new Date(d.filed_at).toLocaleDateString()}{" "}
              <span className="text-gray-600 text-xs">
                {new Date(d.filed_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </div>
          <div className="flex-1 h-px bg-[#1f2028]" />
          <div className="text-center">
            {d.resolved_at ? (
              <>
                <div className="text-xs text-gray-500 mb-1">Resolved</div>
                <div className="text-sm font-mono text-gray-300">
                  {new Date(d.resolved_at).toLocaleDateString()}{" "}
                  <span className="text-gray-600 text-xs">
                    {new Date(d.resolved_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-gray-500 mb-1">Pending</div>
                <div className="text-sm text-gray-600">—</div>
              </>
            )}
          </div>
        </div>

        {/* Job reference */}
        <div className="mb-6 p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">
            Job
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono text-gray-300">
              {d.job_id.slice(0, 8)}…{d.job_id.slice(-4)}
            </span>
            {d.jobs?.rate_amount != null && (
              <span className="text-sm text-gray-400">
                ${d.jobs.rate_amount} charged
              </span>
            )}
          </div>
        </div>

        {/* Reason */}
        <div className="mb-6 p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">
            Dispute Reason
          </div>
          <p className="text-sm text-gray-200 whitespace-pre-line">{d.reason}</p>
        </div>

        {/* Evidence */}
        {(inputEnvelope || outputEnvelope) && (
          <div className="mb-6">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">
              Evidence
            </div>
            <div className="space-y-3">
              {inputEnvelope && (
                <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                  <div className="text-xs text-gray-600 mb-2">Input Envelope</div>
                  <pre className="text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(inputEnvelope, null, 2)}
                  </pre>
                </div>
              )}
              {outputEnvelope && (
                <div className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
                  <div className="text-xs text-gray-600 mb-2">Output Envelope</div>
                  <pre className="text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(outputEnvelope, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Resolver notes */}
        {d.resolver_notes && (
          <div className="mb-6 p-4 bg-[#111118] border border-[#1f2028] rounded-lg border-l-2 border-l-cyan-800">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">
              Resolver Notes
            </div>
            <p className="text-sm text-gray-300 whitespace-pre-line">
              {d.resolver_notes}
            </p>
          </div>
        )}

        {/* Deposits */}
        {d.dispute_deposits && d.dispute_deposits.length > 0 && (
          <div className="mb-6 p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">
              Dispute Deposit
            </div>
            {d.dispute_deposits.map((dep) => (
              <div
                key={dep.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-gray-400">
                  {(dep.amount_millicents / 100000).toFixed(4)} credits
                </span>
                <span className={`text-xs font-medium ${depositStatusLabel(dep.status)}`}>
                  {dep.status}
                </span>
              </div>
            ))}
            {d.status === "open" || d.status === "reviewing" ? (
              <p className="text-xs text-gray-600 mt-2">
                Deposit is held and will be returned if your dispute is upheld.
              </p>
            ) : null}
          </div>
        )}

        {/* Panel votes (Tier 2+) */}
        {d.tier >= 2 && panelVotes.length > 0 && (
          <div className="mb-6 p-4 bg-[#111118] border border-[#1f2028] rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-gray-500 uppercase tracking-widest">
                Community Panel Votes
              </div>
              <div className="text-xs font-medium">
                <span className="text-green-400">{upheldCount} uphold</span>
                <span className="text-gray-600 mx-1">/</span>
                <span className="text-red-400">{rejectedCount} reject</span>
              </div>
            </div>
            <div className="space-y-3">
              {panelVotes.map((vote) => (
                <div
                  key={vote.id}
                  className="flex items-start gap-3"
                >
                  <div className="shrink-0 pt-0.5">
                    {vote.vote === "upheld" ? (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30">
                        upheld
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30">
                        rejected
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-xs text-gray-400 font-medium">
                      {vote.agents?.name ?? "Unknown Agent"}
                    </span>
                    {vote.reasoning && (
                      <p className="text-xs text-gray-600 mt-0.5">
                        {vote.reasoning}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tier indicator */}
        <div className="text-xs text-gray-600 text-center">
          Tier {d.tier} resolution
          {d.tier === 1 && " — AI auto-resolution"}
          {d.tier === 2 && " — Human panel review"}
          {d.tier === 3 && " — Senior arbitration"}
        </div>
      </main>
    </div>
  );
}
