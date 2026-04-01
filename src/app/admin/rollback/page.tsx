import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import AuthButton from "@/components/AuthButton";

interface RollbackPageProps {
  searchParams?: Promise<{ agent?: string }>;
}

export default async function AdminRollbackPage({ searchParams }: RollbackPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) redirect("/dashboard");

  const sp = (await searchParams) ?? {};

  const { data: agents } = await admin
    .from("agents")
    .select("id, slug, name, model_id, health_status")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(100);

  const agentList = agents ?? [];
  const selectedSlug = sp.agent ?? agentList[0]?.slug ?? null;

  const selectedAgent = agentList.find((a) => a.slug === selectedSlug) ?? null;

  const [policyResult, incidentsResult, snapshotsResult] = selectedAgent
    ? await Promise.all([
        admin
          .from("agent_rollback_policies")
          .select("enabled, mode, min_sample_size, max_error_rate, max_latency_ms, min_success_rate, min_trust_score, cooldown_minutes, updated_at")
          .eq("agent_id", selectedAgent.id)
          .maybeSingle(),
        admin
          .from("agent_rollback_incidents")
          .select("id, status, trigger_mode, rollback_mode, rollback_executed, source, reason, cooldown_until, created_at, resolved_at")
          .eq("agent_id", selectedAgent.id)
          .order("created_at", { ascending: false })
          .limit(20),
        admin
          .from("agent_config_snapshots")
          .select("id, source, is_known_good, model_id, created_at")
          .eq("agent_id", selectedAgent.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ])
    : [{ data: null }, { data: [] }, { data: [] }];

  const policy = policyResult.data;
  const incidents = incidentsResult.data ?? [];
  const snapshots = snapshotsResult.data ?? [];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[#1f2028] bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-10">
        <Link href="/" className="text-xl font-bold tracking-tight">
          Signal<span className="text-cyan-400">Pot</span>
          <span className="ml-2 text-xs font-normal text-amber-300 border border-amber-400/40 rounded px-1.5 py-0.5">
            Rollback Ops
          </span>
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/admin/disputes" className="text-sm text-gray-400 hover:text-white transition-colors">
            Admin Disputes
          </Link>
          <Link href="/dashboard" className="text-sm text-gray-400 hover:text-white transition-colors">
            Dashboard
          </Link>
          <AuthButton />
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <section className="bg-[#111118] border border-[#1f2028] rounded-xl p-5">
          <h1 className="text-2xl font-bold mb-2">Auto-Rollback Guardrail</h1>
          <p className="text-sm text-gray-400">
            Run simulate/trigger actions, tune policy thresholds, and resolve incidents from one operator panel.
          </p>
        </section>

        <section className="bg-[#111118] border border-[#1f2028] rounded-xl p-5">
          <form method="GET" className="flex flex-wrap items-end gap-4">
            <label className="text-sm text-gray-300">
              Agent
              <select
                name="agent"
                defaultValue={selectedSlug ?? ""}
                className="mt-1 block min-w-72 rounded-lg bg-[#0d0d14] border border-[#2a2b38] px-3 py-2 text-sm"
              >
                {agentList.map((agent) => (
                  <option key={agent.id} value={agent.slug}>
                    {agent.name} ({agent.slug})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-cyan-700 hover:bg-cyan-600 transition-colors"
            >
              Load
            </button>
          </form>
        </section>

        {selectedAgent ? (
          <>
            <section className="grid md:grid-cols-3 gap-4">
              <div className="bg-[#111118] border border-[#1f2028] rounded-xl p-4">
                <div className="text-xs uppercase tracking-widest text-gray-500 mb-1">Current Model</div>
                <div className="text-sm text-gray-200 break-all">{selectedAgent.model_id ?? "(none)"}</div>
              </div>
              <div className="bg-[#111118] border border-[#1f2028] rounded-xl p-4">
                <div className="text-xs uppercase tracking-widest text-gray-500 mb-1">Health</div>
                <div className="text-sm text-gray-200">{selectedAgent.health_status ?? "unknown"}</div>
              </div>
              <div className="bg-[#111118] border border-[#1f2028] rounded-xl p-4">
                <div className="text-xs uppercase tracking-widest text-gray-500 mb-1">Guardrail Mode</div>
                <div className="text-sm text-gray-200">{policy?.mode ?? "dry_run (default)"}</div>
              </div>
            </section>

            <section className="bg-[#111118] border border-[#1f2028] rounded-xl p-5">
              <h2 className="font-semibold mb-4">Run Simulate / Trigger</h2>
              <form action={`/api/agents/${selectedAgent.slug}/rollback`} method="POST" className="grid md:grid-cols-2 gap-3">
                <input type="hidden" name="source" value="admin_panel" />
                <label className="text-sm text-gray-300">Sample size
                  <input name="sample_size" type="number" min={1} defaultValue={25} className="mt-1 w-full rounded-lg bg-[#0d0d14] border border-[#2a2b38] px-3 py-2" />
                </label>
                <label className="text-sm text-gray-300">Error rate (0-1)
                  <input name="error_rate" type="number" min={0} max={1} step="0.01" defaultValue={0.12} className="mt-1 w-full rounded-lg bg-[#0d0d14] border border-[#2a2b38] px-3 py-2" />
                </label>
                <label className="text-sm text-gray-300">Avg latency (ms)
                  <input name="avg_latency_ms" type="number" min={0} defaultValue={4200} className="mt-1 w-full rounded-lg bg-[#0d0d14] border border-[#2a2b38] px-3 py-2" />
                </label>
                <label className="text-sm text-gray-300">Success rate (0-1)
                  <input name="success_rate" type="number" min={0} max={1} step="0.01" defaultValue={0.82} className="mt-1 w-full rounded-lg bg-[#0d0d14] border border-[#2a2b38] px-3 py-2" />
                </label>
                <label className="text-sm text-gray-300 md:col-span-2">Trust score (0-1)
                  <input name="trust_score" type="number" min={0} max={1} step="0.01" defaultValue={0.48} className="mt-1 w-full rounded-lg bg-[#0d0d14] border border-[#2a2b38] px-3 py-2" />
                </label>
                <div className="flex gap-3 md:col-span-2 pt-2">
                  <button name="action" value="simulate" type="submit" className="px-4 py-2 rounded-lg text-sm font-medium bg-[#2a2b38] hover:bg-[#34364a] transition-colors">
                    Simulate
                  </button>
                  <button name="action" value="trigger" type="submit" className="px-4 py-2 rounded-lg text-sm font-medium bg-red-700 hover:bg-red-600 transition-colors">
                    Trigger
                  </button>
                </div>
              </form>
            </section>

            <section className="bg-[#111118] border border-[#1f2028] rounded-xl p-5">
              <h2 className="font-semibold mb-4">Policy</h2>
              <form action={`/api/agents/${selectedAgent.slug}/rollback`} method="POST" className="grid md:grid-cols-3 gap-3">
                <input type="hidden" name="action" value="policy" />
                <label className="text-sm text-gray-300">Mode
                  <select name="mode" defaultValue={policy?.mode ?? "dry_run"} className="mt-1 w-full rounded-lg bg-[#0d0d14] border border-[#2a2b38] px-3 py-2">
                    <option value="dry_run">dry_run</option>
                    <option value="active">active</option>
                  </select>
                </label>
                <label className="text-sm text-gray-300">Min sample size
                  <input name="min_sample_size" type="number" min={1} defaultValue={policy?.min_sample_size ?? 20} className="mt-1 w-full rounded-lg bg-[#0d0d14] border border-[#2a2b38] px-3 py-2" />
                </label>
                <label className="text-sm text-gray-300">Max error rate
                  <input name="max_error_rate" type="number" min={0} max={1} step="0.01" defaultValue={policy?.max_error_rate ?? 0.08} className="mt-1 w-full rounded-lg bg-[#0d0d14] border border-[#2a2b38] px-3 py-2" />
                </label>
                <label className="text-sm text-gray-300">Max latency ms
                  <input name="max_latency_ms" type="number" min={1} defaultValue={policy?.max_latency_ms ?? 3000} className="mt-1 w-full rounded-lg bg-[#0d0d14] border border-[#2a2b38] px-3 py-2" />
                </label>
                <label className="text-sm text-gray-300">Min success rate
                  <input name="min_success_rate" type="number" min={0} max={1} step="0.01" defaultValue={policy?.min_success_rate ?? 0.9} className="mt-1 w-full rounded-lg bg-[#0d0d14] border border-[#2a2b38] px-3 py-2" />
                </label>
                <label className="text-sm text-gray-300">Min trust score
                  <input name="min_trust_score" type="number" min={0} max={1} step="0.01" defaultValue={policy?.min_trust_score ?? 0.55} className="mt-1 w-full rounded-lg bg-[#0d0d14] border border-[#2a2b38] px-3 py-2" />
                </label>
                <label className="text-sm text-gray-300">Cooldown minutes
                  <input name="cooldown_minutes" type="number" min={1} defaultValue={policy?.cooldown_minutes ?? 30} className="mt-1 w-full rounded-lg bg-[#0d0d14] border border-[#2a2b38] px-3 py-2" />
                </label>
                <label className="text-sm text-gray-300 flex items-center gap-2 pt-7">
                  <input name="enabled" type="checkbox" value="true" defaultChecked={policy?.enabled ?? true} />
                  Enabled
                </label>
                <div className="md:col-span-3 pt-2">
                  <button type="submit" className="px-4 py-2 rounded-lg text-sm font-medium bg-cyan-700 hover:bg-cyan-600 transition-colors">
                    Save policy
                  </button>
                </div>
              </form>
            </section>

            <section className="bg-[#111118] border border-[#1f2028] rounded-xl p-5">
              <h2 className="font-semibold mb-4">Recent Incidents</h2>
              <div className="space-y-3">
                {incidents.length === 0 ? (
                  <p className="text-sm text-gray-500">No rollback incidents yet.</p>
                ) : (
                  incidents.map((incident) => (
                    <div key={incident.id} className="border border-[#242538] rounded-lg p-3">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        <span className="font-mono text-gray-400">{incident.id.slice(0, 8)}...{incident.id.slice(-4)}</span>
                        <span className="text-gray-200">{incident.status}</span>
                        <span className="text-gray-400">{incident.trigger_mode}</span>
                        <span className="text-gray-400">{incident.rollback_mode}</span>
                        <span className="text-gray-500">{new Date(incident.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-gray-300 mt-2">{incident.reason ?? "(no summary)"}</p>
                      <div className="flex gap-2 mt-3">
                        <form action={`/api/agents/${selectedAgent.slug}/rollback`} method="POST" className="contents">
                          <input type="hidden" name="action" value="acknowledge" />
                          <input type="hidden" name="incident_id" value={incident.id} />
                          <button type="submit" className="px-3 py-1.5 rounded text-xs font-medium bg-[#2a2b38] hover:bg-[#34364a] transition-colors">
                            Acknowledge
                          </button>
                        </form>
                        <form action={`/api/agents/${selectedAgent.slug}/rollback`} method="POST" className="contents">
                          <input type="hidden" name="action" value="resolve" />
                          <input type="hidden" name="incident_id" value={incident.id} />
                          <button type="submit" className="px-3 py-1.5 rounded text-xs font-medium bg-green-700 hover:bg-green-600 transition-colors">
                            Resolve
                          </button>
                        </form>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="bg-[#111118] border border-[#1f2028] rounded-xl p-5">
              <h2 className="font-semibold mb-4">Recent Snapshots</h2>
              <div className="space-y-2">
                {snapshots.length === 0 ? (
                  <p className="text-sm text-gray-500">No config snapshots captured yet.</p>
                ) : (
                  snapshots.map((snapshot) => (
                    <div key={snapshot.id} className="border border-[#242538] rounded-lg p-3 text-sm text-gray-300 flex flex-wrap gap-x-4 gap-y-1">
                      <span className="font-mono text-gray-400">{snapshot.id.slice(0, 8)}...{snapshot.id.slice(-4)}</span>
                      <span>{snapshot.source}</span>
                      <span>{snapshot.is_known_good ? "known-good" : "baseline"}</span>
                      <span className="text-gray-500">{new Date(snapshot.created_at).toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        ) : (
          <section className="bg-[#111118] border border-[#1f2028] rounded-xl p-5 text-sm text-gray-400">
            No active agents found.
          </section>
        )}
      </main>
    </div>
  );
}
