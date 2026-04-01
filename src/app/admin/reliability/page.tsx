import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import AuthButton from "@/components/AuthButton";

export default async function AdminReliabilityPage() {
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

  const [{ data: agents }, { data: incidents }, { data: recentSnapshots }] = await Promise.all([
    admin
      .from("agents")
      .select("id, name, slug, reliability_score, reliability_band, traffic_mode, canary_percent, freeze_until, reliability_checked_at")
      .eq("status", "active")
      .order("reliability_score", { ascending: true, nullsFirst: true })
      .limit(40),
    admin
      .from("agent_rollback_incidents")
      .select("id, agent_id, status, trigger_mode, rollback_executed, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    admin
      .from("agent_reliability_snapshots")
      .select("id, agent_id, reliability_score, reliability_band, sample_size, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const agentList = agents ?? [];
  const incidentList = incidents ?? [];
  const snapshotList = recentSnapshots ?? [];

  const total = agentList.length;
  const elite = agentList.filter((a) => a.reliability_band === "elite").length;
  const watch = agentList.filter((a) => a.reliability_band === "watch").length;
  const critical = agentList.filter((a) => a.reliability_band === "critical").length;
  const frozen = agentList.filter((a) => a.traffic_mode === "frozen").length;

  const agentNameById = new Map(agentList.map((a) => [a.id as string, `${a.name} (${a.slug})`]));

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[#1f2028] bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-10">
        <Link href="/" className="text-xl font-bold tracking-tight">
          Signal<span className="text-cyan-400">Pot</span>
          <span className="ml-2 text-xs font-normal text-cyan-300 border border-cyan-400/40 rounded px-1.5 py-0.5">
            Control Tower
          </span>
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/admin/rollback" className="text-sm text-gray-400 hover:text-white transition-colors">Rollback Ops</Link>
          <Link href="/admin/disputes" className="text-sm text-gray-400 hover:text-white transition-colors">Disputes</Link>
          <AuthButton />
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <section className="bg-[#111118] border border-[#1f2028] rounded-xl p-5">
          <h1 className="text-2xl font-bold">Trust Control Tower</h1>
          <p className="text-sm text-gray-400 mt-2">
            Real-time fleet reliability, traffic safety state, and incident pressure in one surface.
          </p>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <MetricCard label="Active Agents" value={String(total)} accent="text-cyan-300" />
          <MetricCard label="Elite" value={String(elite)} accent="text-emerald-300" />
          <MetricCard label="Watch" value={String(watch)} accent="text-yellow-300" />
          <MetricCard label="Critical" value={String(critical)} accent="text-red-300" />
          <MetricCard label="Frozen" value={String(frozen)} accent="text-orange-300" />
        </section>

        <section className="bg-[#111118] border border-[#1f2028] rounded-xl p-5">
          <h2 className="font-semibold mb-4">Risk Queue (Lowest Reliability First)</h2>
          <div className="space-y-3">
            {agentList.length === 0 ? (
              <p className="text-sm text-gray-500">No active agents.</p>
            ) : (
              agentList.map((agent) => (
                <div key={agent.id} className="border border-[#242538] rounded-lg p-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <Link href={`/agents/${agent.slug}`} className="text-cyan-300 hover:text-cyan-200">
                    {agent.name}
                  </Link>
                  <span className="text-gray-500">/{agent.slug}</span>
                  <BandPill band={(agent.reliability_band as string | null) ?? "unknown"} />
                  <span className="text-gray-300">
                    score: {agent.reliability_score == null ? "—" : `${Math.round(Number(agent.reliability_score) * 100)}%`}
                  </span>
                  <span className="text-gray-400">traffic: {agent.traffic_mode ?? "normal"}</span>
                  <span className="text-gray-500">canary: {agent.canary_percent ?? 100}%</span>
                  {agent.freeze_until && (
                    <span className="text-orange-300">frozen until {new Date(agent.freeze_until).toLocaleString()}</span>
                  )}
                  {agent.reliability_checked_at && (
                    <span className="text-gray-600">updated {new Date(agent.reliability_checked_at).toLocaleString()}</span>
                  )}
                  <Link
                    href={`/admin/rollback?agent=${encodeURIComponent(agent.slug as string)}`}
                    className="ml-auto px-2.5 py-1 rounded text-xs bg-[#1f2433] hover:bg-[#2a3044] text-cyan-200"
                  >
                    Operate
                  </Link>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="grid md:grid-cols-2 gap-6">
          <div className="bg-[#111118] border border-[#1f2028] rounded-xl p-5">
            <h2 className="font-semibold mb-4">Recent Rollback Incidents</h2>
            <div className="space-y-3">
              {incidentList.length === 0 ? (
                <p className="text-sm text-gray-500">No incidents recorded.</p>
              ) : (
                incidentList.map((incident) => (
                  <div key={incident.id} className="border border-[#242538] rounded-lg p-3 text-sm">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 items-center">
                      <span className="font-mono text-gray-400">{String(incident.id).slice(0, 8)}...{String(incident.id).slice(-4)}</span>
                      <span className="text-gray-200">{incident.status}</span>
                      <span className="text-gray-400">{incident.trigger_mode}</span>
                      {incident.rollback_executed && <span className="text-red-300">rollback executed</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{new Date(incident.created_at).toLocaleString()}</div>
                    <div className="text-xs text-gray-300 mt-2">{incident.reason ?? "(no reason summary)"}</div>
                    <div className="text-xs text-cyan-300 mt-1">{agentNameById.get(String(incident.agent_id)) ?? String(incident.agent_id)}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-[#111118] border border-[#1f2028] rounded-xl p-5">
            <h2 className="font-semibold mb-4">Reliability Pulse (Latest 50)</h2>
            <div className="space-y-2">
              {snapshotList.length === 0 ? (
                <p className="text-sm text-gray-500">No snapshots yet.</p>
              ) : (
                snapshotList.map((snap) => (
                  <div key={snap.id} className="border border-[#242538] rounded-lg p-3 text-sm flex flex-wrap gap-x-3 gap-y-1">
                    <span className="text-gray-300">{agentNameById.get(String(snap.agent_id)) ?? String(snap.agent_id)}</span>
                    <BandPill band={String(snap.reliability_band)} />
                    <span className="text-gray-400">score {(Number(snap.reliability_score) * 100).toFixed(1)}%</span>
                    <span className="text-gray-500">n={snap.sample_size}</span>
                    <span className="text-gray-600">{new Date(snap.created_at).toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-[#111118] border border-[#1f2028] rounded-xl p-4">
      <div className="text-xs uppercase tracking-widest text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-semibold ${accent}`}>{value}</div>
    </div>
  );
}

function BandPill({ band }: { band: string }) {
  const cls =
    band === "elite"
      ? "bg-emerald-950/50 text-emerald-300 border-emerald-700/50"
      : band === "strong"
        ? "bg-cyan-950/50 text-cyan-300 border-cyan-700/50"
        : band === "watch"
          ? "bg-yellow-950/50 text-yellow-300 border-yellow-700/50"
          : band === "critical"
            ? "bg-red-950/50 text-red-300 border-red-700/50"
            : "bg-gray-900/50 text-gray-400 border-gray-700/50";

  return (
    <span className={`px-2 py-0.5 text-xs rounded border ${cls}`}>
      {band}
    </span>
  );
}
