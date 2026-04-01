import SiteNav from "@/components/SiteNav";

const outcomes = [
  "Stop silent failure paths that leak revenue",
  "Reduce high-severity incident risk from auth/scope bugs",
  "Shorten time-to-fix with reproducible attack and failure traces",
  "Give engineering and product one ranked remediation backlog",
];

const deliverables = [
  "Abuse and failure map (money flow, trust flow, auth flow)",
  "Top 10 vulnerabilities and reliability risks with severity",
  "Replayable proof steps and test cases",
  "Patch recommendations that preserve throughput",
  "30-day stabilization checklist",
];

export default function AuditPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />

      <main className="max-w-5xl mx-auto px-4 py-16">
        <section className="mb-10">
          <p className="text-xs tracking-[0.2em] uppercase text-cyan-300 mb-3">
            Agent Reliability Audit
          </p>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-4">
            Turn fragile agent behavior into a revenue-safe production system.
          </h1>
          <p className="text-lg text-gray-300 max-w-3xl">
            We run a focused offensive + reliability pass against your deployed agent stack,
            then hand your team a prioritized fix plan that can ship fast without tanking performance.
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            <a
              href="/contact?intent=audit"
              className="px-6 py-3 rounded-lg bg-cyan-400 text-[#0a0a0f] font-semibold hover:bg-cyan-300 transition-colors"
            >
              Request Audit
            </a>
            <a
              href="mailto:support@signalpot.dev?subject=Agent%20Reliability%20Audit"
              className="px-6 py-3 rounded-lg border border-[#2d3044] text-gray-200 hover:border-cyan-400/40 hover:text-white transition-colors"
            >
              Email Sales
            </a>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">
          {outcomes.map((outcome) => (
            <div key={outcome} className="rounded-xl border border-[#1f2028] bg-[#111118] p-5">
              <p className="text-sm text-gray-200">{outcome}</p>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-[#1f2028] bg-[#111118] p-8 mb-10">
          <h2 className="text-2xl font-bold mb-4">What you get</h2>
          <ul className="space-y-3">
            {deliverables.map((item) => (
              <li key={item} className="text-sm text-gray-300 flex items-start gap-2">
                <span className="text-cyan-400 mt-0.5">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">
          <article className="rounded-xl border border-[#1f2028] bg-[#111118] p-6">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Starter Audit</p>
            <h3 className="text-3xl font-bold mb-2">$2,000</h3>
            <p className="text-sm text-gray-300 mb-4">
              One-week sprint for one critical workflow. Best for teams that need quick confidence before launch.
            </p>
            <ul className="space-y-2 text-sm text-gray-400 mb-6">
              <li>Scope: one workflow, one environment</li>
              <li>Delivery: 5 business days</li>
              <li>Support: 48-hour async follow-up</li>
            </ul>
            <a
              href="/contact?intent=audit-starter"
              className="inline-block px-5 py-2.5 rounded-lg bg-cyan-400 text-[#0a0a0f] font-semibold hover:bg-cyan-300 transition-colors"
            >
              Start Starter Audit
            </a>
          </article>

          <article className="rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-6">
            <p className="text-xs text-cyan-300 uppercase tracking-widest mb-1">Full Audit</p>
            <h3 className="text-3xl font-bold mb-2">$6,000</h3>
            <p className="text-sm text-gray-200 mb-4">
              Three-week deep pass across auth, tenancy boundaries, monetization, and trust integrity.
            </p>
            <ul className="space-y-2 text-sm text-gray-300 mb-6">
              <li>Scope: multi-flow production paths</li>
              <li>Delivery: 15 business days</li>
              <li>Support: rollout guidance and retest</li>
            </ul>
            <a
              href="/contact?intent=audit-full"
              className="inline-block px-5 py-2.5 rounded-lg bg-cyan-400 text-[#0a0a0f] font-semibold hover:bg-cyan-300 transition-colors"
            >
              Start Full Audit
            </a>
          </article>
        </section>

        <section className="rounded-xl border border-[#1f2028] bg-[#111118] p-8 text-center">
          <h2 className="text-2xl font-bold mb-3">Fast path to first deal</h2>
          <p className="text-gray-300 mb-6">
            If you are selling this service yourself, use our outbound scripts and launch checklist to get
            your first two customers this week.
          </p>
          <a
            href="/revenue-playbook"
            className="inline-block px-6 py-3 rounded-lg border border-[#2d3044] text-gray-200 hover:border-cyan-400/40 hover:text-white transition-colors"
          >
            Open Revenue Playbook
          </a>
        </section>
      </main>
    </div>
  );
}
