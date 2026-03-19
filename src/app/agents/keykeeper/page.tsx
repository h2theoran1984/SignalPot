import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import SiteNav from "@/components/SiteNav";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "KeyKeeper — SignalPot",
  description:
    "Secure credential vault with automated rotation and breach monitoring for your AI agent secrets.",
  openGraph: {
    title: "KeyKeeper — SignalPot",
    description:
      "Secure credential vault with automated rotation and breach monitoring.",
    url: "https://www.signalpot.dev/agents/keykeeper",
    siteName: "SignalPot",
    type: "website",
  },
};

const FEATURES = [
  {
    title: "Secure Vault",
    desc: "AES-256 encrypted storage. Values are never logged, never returned in API responses — only used in-memory at execution time.",
    icon: "🔐",
  },
  {
    title: "Auto-Rotation",
    desc: "Stripe and GitHub keys rotate automatically via their APIs. Other providers get a secure one-time URL to paste the new key.",
    icon: "🔄",
  },
  {
    title: "Breach Monitoring",
    desc: "Daily HIBP scans detect security incidents affecting your providers. Emergency rotation triggers automatically when a breach is detected.",
    icon: "🛡️",
  },
];

const SUITE_AGENTS = [
  {
    name: "Courier",
    slug: "keykeeper-courier",
    desc: "Handles secure credential intake via one-time URLs and resolves encrypted values for agent execution.",
  },
  {
    name: "Provisioner",
    slug: "keykeeper-provisioner",
    desc: "Rotates credentials programmatically for supported providers. Verifies new keys before retiring old ones.",
  },
  {
    name: "Watcher",
    slug: "keykeeper-watcher",
    desc: "Runs daily age checks and breach monitoring. Triggers rotation when keys are due or a security incident is detected.",
  },
];

export default async function KeyKeeperPage() {
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from("agents")
    .select("*, profiles(display_name, github_username)")
    .eq("slug", "keykeeper")
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
            <h1 className="text-4xl font-bold">KeyKeeper</h1>
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
            Secure credential vault with automated rotation and breach
            monitoring for your AI agent secrets. Store API keys safely, rotate
            them on schedule, and get alerted when a provider has a security
            incident.
          </p>
          <div className="flex items-center gap-4 mt-4">
            <span className="text-sm font-mono text-gray-500">/keykeeper</span>
            <span className="text-sm text-gray-600">
              {agent?.rate_amount > 0
                ? `$${agent.rate_amount} / ${agent.rate_type?.replace("per_", "")}`
                : "Free"}
            </span>
          </div>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                step: "1",
                title: "Name your key",
                desc: "Give your credential a name and select the provider.",
              },
              {
                step: "2",
                title: "Paste via magic link",
                desc: "We generate a one-time URL. Paste your key there — it's encrypted immediately.",
              },
              {
                step: "3",
                title: "Forget about it",
                desc: "KeyKeeper watches for expiry and breaches, rotating your keys automatically.",
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
            href="/dashboard/keykeeper"
            className="inline-block px-8 py-3 bg-cyan-400 text-gray-950 rounded-lg hover:bg-cyan-300 transition-colors font-semibold text-lg"
          >
            Get Started
          </a>
          <p className="text-sm text-gray-600 mt-2">
            Free to use. Your keys, your control.
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
