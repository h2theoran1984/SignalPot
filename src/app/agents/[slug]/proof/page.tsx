import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computeReliabilityScore, explainDelta, type ReliabilityResult } from "@/lib/reliability";

export default async function AgentProofPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from("agents")
    .select("id, name, slug, reliability_score, reliability_band, reliability_checked_at, traffic_mode, canary_percent, freeze_until")
    .eq("slug", slug)
    .eq("status", "active")
    .single();

  if (!agent) notFound();

  const [{ data: snaps }, { data: incidents }] = await Promise.all([
    supabase
      .from("agent_reliability_snapshots")
      .select("id, sample_size, success_rate, error_rate, avg_latency_ms, trust_score, health_component, reliability_score, reliability_band, drivers, created_at")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("agent_rollback_incidents")
      .select("id, status, trigger_mode, rollback_executed, reason, created_at")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const latest = snaps?.[0] ?? null;
  const previous = snaps?.[1] ?? null;

  let delta = "No historical delta yet.";
  if (latest) {
    const current: ReliabilityResult = {
      score: Number(latest.reliability_score ?? 0),
      band: (latest.reliability_band ?? "unknown") as ReliabilityResult["band"],
      drivers: {
        success_component: Number((latest.drivers as Record<string, unknown> | null)?.success_component ?? 0),
        error_component: Number((latest.drivers as Record<string, unknown> | null)?.error_component ?? 0),
        latency_component: Number((latest.drivers as Record<string, unknown> | null)?.latency_component ?? 0),
        trust_component: Number((latest.drivers as Record<string, unknown> | null)?.trust_component ?? 0),
        health_component: Number((latest.drivers as Record<string, unknown> | null)?.health_component ?? 0),
      },
    };

    const prev = previous
      ? computeReliabilityScore({
          successRate: Number(previous.success_rate ?? 0),
          errorRate: Number(previous.error_rate ?? 0),
          avgLatencyMs: Number(previous.avg_latency_ms ?? 0),
          trustScore: Number(previous.trust_score ?? 0),
          healthComponent: Number(previous.health_component ?? 0),
        })
      : null;

    delta = explainDelta(current, prev);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <main className="max-w-4xl mx-auto px-4 py-10 space-y-6">
        <section className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-500">Public Proof Card</div>
            <h1 className="text-3xl font-bold mt-1">{agent.name}</h1>
            <div className="text-sm text-gray-400">/{agent.slug}</div>
          </div>
          <Link href={`/agents/${agent.slug}`} className="text-sm text-cyan-300 hover:text-cyan-200">
            Back to agent
          </Link>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <ProofMetric label="Reliability" value={agent.reliability_score == null ? "—" : `${Math.round(Number(agent.reliability_score) * 100)}%`} />
          <ProofMetric label="Band" value={String(agent.reliability_band ?? "unknown")} />
          <ProofMetric label="Traffic" value={String(agent.traffic_mode ?? "normal")} />
          <ProofMetric label="Canary" value={`${agent.canary_percent ?? 100}%`} />
        </section>

        <section className="bg-[#111118] border border-[#1f2028] rounded-xl p-5">
          <h2 className="font-semibold mb-2">Why It Moved</h2>
          <p className="text-sm text-gray-300">{delta}</p>
          {agent.freeze_until && (
            <p className="text-sm text-orange-300 mt-2">Frozen until {new Date(agent.freeze_until).toLocaleString()}</p>
          )}
          {agent.reliability_checked_at && (
            <p className="text-xs text-gray-500 mt-2">Updated {new Date(agent.reliability_checked_at).toLocaleString()}</p>
          )}
        </section>

        <section className="bg-[#111118] border border-[#1f2028] rounded-xl p-5">
          <h2 className="font-semibold mb-4">Latest Reliability Evidence</h2>
          {latest ? (
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <Evidence label="Sample size" value={String(latest.sample_size)} />
              <Evidence label="Success rate" value={`${(Number(latest.success_rate) * 100).toFixed(1)}%`} />
              <Evidence label="Error rate" value={`${(Number(latest.error_rate) * 100).toFixed(1)}%`} />
              <Evidence label="Avg latency" value={`${latest.avg_latency_ms}ms`} />
              <Evidence label="Trust score" value={`${(Number(latest.trust_score) * 100).toFixed(1)}%`} />
              <Evidence label="Health component" value={`${(Number(latest.health_component) * 100).toFixed(1)}%`} />
            </div>
          ) : (
            <p className="text-sm text-gray-500">No reliability snapshots captured yet.</p>
          )}
        </section>

        <section className="bg-[#111118] border border-[#1f2028] rounded-xl p-5">
          <h2 className="font-semibold mb-4">Incident Timeline</h2>
          <div className="space-y-3">
            {(incidents ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No incidents recorded.</p>
            ) : (
              (incidents ?? []).map((incident) => (
                <div key={incident.id} className="border border-[#242538] rounded-lg p-3 text-sm">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <span className="text-gray-200">{incident.status}</span>
                    <span className="text-gray-400">{incident.trigger_mode}</span>
                    {incident.rollback_executed && <span className="text-red-300">rollback executed</span>}
                    <span className="text-gray-600">{new Date(incident.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-gray-300 mt-2">{incident.reason ?? "(no summary)"}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function ProofMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#111118] border border-[#1f2028] rounded-xl p-4">
      <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">{label}</div>
      <div className="text-lg font-semibold text-cyan-200">{value}</div>
    </div>
  );
}

function Evidence({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#242538] rounded-lg p-3">
      <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">{label}</div>
      <div className="text-sm text-gray-200">{value}</div>
    </div>
  );
}
