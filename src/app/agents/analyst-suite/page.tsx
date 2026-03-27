import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import SiteNav from "@/components/SiteNav";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Analyst Suite — SignalPot",
  description:
    "Multi-source data normalization, validation, trend analysis, and automated reporting. Turn messy vendor data into clean, actionable insights.",
  openGraph: {
    title: "Analyst Suite — SignalPot",
    description:
      "Multi-source data normalization, validation, trend analysis, and automated reporting.",
    url: "https://www.signalpot.dev/agents/analyst-suite",
    siteName: "SignalPot",
    type: "website",
  },
};

const FEATURES = [
  {
    title: "Smart Normalization",
    desc: "Entity resolution powered by Rosetta v2. Maps variant names across vendors to your canonical taxonomy — learns from every correction.",
    icon: "🔀",
  },
  {
    title: "Automated Validation",
    desc: "Sentinel checks every dataset against configurable rules and historical patterns. Catches anomalies before they reach your reports.",
    icon: "✅",
  },
  {
    title: "Root Cause Investigation",
    desc: "Pathfinder traverses dimensions laterally and hierarchically to find why metrics shifted — even when the signal appears at a different level than its source.",
    icon: "🔍",
  },
  {
    title: "Presentation-Ready Output",
    desc: "Brief compiles analysis into formatted reports, slide-ready data, and chart configurations matching your templates.",
    icon: "📊",
  },
];

const SUITE_AGENTS = [
  {
    name: "Rosetta",
    slug: "analyst-rosetta",
    desc: "Entity resolution and data normalization engine",
  },
  {
    name: "Sentinel",
    slug: "analyst-sentinel",
    desc: "Data validation and anomaly detection",
  },
  {
    name: "Pathfinder",
    slug: "analyst-pathfinder",
    desc: "Automated root cause investigation",
  },
  {
    name: "Brief",
    slug: "analyst-brief",
    desc: "Presentation compilation and formatting",
  },
];

export default async function AnalystSuitePage() {
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from("agents")
    .select("*, profiles(display_name, github_username)")
    .eq("slug", "analyst-suite")
    .single();

  const { data: children } = await supabase
    .from("agents")
    .select("name, slug, description, status, tags")
    .eq("parent_agent_id", agent?.id ?? "")
    .order("created_at", { ascending: true });

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-4xl font-bold">Analyst Suite</h1>
            <Badge variant="tag">suite</Badge>
            {agent && (
              <Badge
                variant="status"
                status={agent.status as "active" | "inactive"}
              >
                {agent.status}
              </Badge>
            )}
          </div>
          <p className="text-lg text-gray-400 max-w-2xl">
            Multi-source data normalization, validation, trend analysis, and
            automated reporting. Turn messy vendor data into clean, actionable
            insights.
          </p>
          <div className="flex items-center gap-4 mt-4">
            <span className="text-sm font-mono text-gray-500">
              /analyst-suite
            </span>
            <span className="text-sm text-gray-600">
              {agent?.rate_amount > 0
                ? `$${agent.rate_amount} / ${agent.rate_type?.replace("per_", "")}`
                : "Free"}
            </span>
          </div>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="p-5 bg-[#111118] border border-[#1f2028] rounded-lg border-t-2 border-t-cyan-400"
            >
              <div className="text-2xl mb-2">{f.icon}</div>
              <h3 className="font-semibold mb-1">{f.title}</h3>
              <p className="text-sm text-gray-400">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* How it works */}
        <div className="mb-10">
          <h2 className="text-xl font-semibold mb-4">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                step: "1",
                title: "Configure",
                desc: "Define your sources, dimensions, and taxonomy",
              },
              {
                step: "2",
                title: "Normalize",
                desc: "Rosetta maps vendor data to canonical entities",
              },
              {
                step: "3",
                title: "Validate",
                desc: "Sentinel flags anomalies and quality issues",
              },
              {
                step: "4",
                title: "Analyze & Report",
                desc: "Pathfinder investigates, Brief compiles output",
              },
            ].map((s) => (
              <div
                key={s.step}
                className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg"
              >
                <div className="w-7 h-7 rounded-full bg-cyan-400/10 text-cyan-400 font-bold text-sm flex items-center justify-center mb-2">
                  {s.step}
                </div>
                <h3 className="font-medium text-sm mb-1">{s.title}</h3>
                <p className="text-xs text-gray-500">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Suite agents */}
        <div className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Suite Agents</h2>
          <div className="space-y-3">
            {(children ?? SUITE_AGENTS).map(
              (child: { name: string; slug: string; description?: string; desc?: string }) => (
                <div
                  key={child.slug}
                  className="p-4 bg-[#111118] border border-[#1f2028] rounded-lg border-l-2 border-l-cyan-800"
                >
                  <h3 className="font-medium font-mono text-cyan-400">
                    {child.name}
                  </h3>
                  <p className="text-sm text-gray-400 mt-1">
                    {child.description ?? child.desc}
                  </p>
                </div>
              )
            )}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center py-8 border-t border-[#1f2028]">
          <a
            href="/dashboard/analyst"
            className="inline-block px-8 py-3 bg-cyan-400 text-gray-950 rounded-lg hover:bg-cyan-300 transition-colors font-semibold text-lg"
          >
            Get Started
          </a>
          <p className="text-sm text-gray-600 mt-2">
            Turn messy vendor data into clean, actionable insights.
          </p>
        </div>

        {/* Owner info */}
        {agent?.profiles && (
          <div className="text-sm text-gray-600 mt-6">
            Built by{" "}
            <span className="text-gray-400">
              {agent.profiles.display_name ??
                agent.profiles.github_username ??
                "SignalPot"}
            </span>
          </div>
        )}
      </main>
    </div>
  );
}
