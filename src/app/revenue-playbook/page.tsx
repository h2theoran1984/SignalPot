import SiteNav from "@/components/SiteNav";

const targetProfile = [
  "AI startups with customer-facing copilots in production",
  "Automation agencies shipping LLM workflows for clients",
  "Internal platform teams managing agent reliability and cost risk",
];

const outreachScript = `Subject: Quick way to de-risk your production agents

Hey {{first_name}},

I noticed your team is shipping AI agents in production.
We run a focused reliability audit that finds money leaks, auth boundary bugs, and trust-signal blind spots before customers hit them.

Would you be open to a 20-minute call this week?
If useful, I can send the one-page audit scope first.

- {{your_name}}`;

const linkedinScript = `Saw your team is actively shipping agents. I run short reliability audits that catch hidden failure and security paths before they become incidents. If useful, I can send the scope doc.`;

export default function RevenuePlaybookPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />
      <main className="max-w-5xl mx-auto px-4 py-16">
        <section className="mb-10">
          <p className="text-xs tracking-[0.2em] uppercase text-cyan-300 mb-3">Revenue Playbook</p>
          <h1 className="text-4xl font-bold mb-3">Land your first two audit customers this week.</h1>
          <p className="text-gray-300 max-w-3xl">
            This is the no-BS playbook: choose a sharp offer, target buyers with real production risk,
            and run high-volume but personalized outreach.
          </p>
        </section>

        <section className="rounded-xl border border-[#1f2028] bg-[#111118] p-8 mb-8">
          <h2 className="text-2xl font-bold mb-4">1) ICP and offer</h2>
          <ul className="space-y-2 mb-6">
            {targetProfile.map((item) => (
              <li key={item} className="text-sm text-gray-300 flex items-start gap-2">
                <span className="text-cyan-400 mt-0.5">•</span>
                {item}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-[#1f2028] bg-[#0a0a0f] p-5">
              <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">Starter</p>
              <p className="text-2xl font-bold mb-2">$2,000</p>
              <p className="text-sm text-gray-300">One-week scope, one flow, quick risk map and fixes.</p>
            </div>
            <div className="rounded-lg border border-cyan-400/30 bg-cyan-400/5 p-5">
              <p className="text-xs uppercase tracking-widest text-cyan-300 mb-1">Full</p>
              <p className="text-2xl font-bold mb-2">$6,000</p>
              <p className="text-sm text-gray-200">Three-week deep pass across auth, tenant scope, trust, and money paths.</p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-[#1f2028] bg-[#111118] p-8 mb-8">
          <h2 className="text-2xl font-bold mb-4">2) Outreach assets</h2>
          <p className="text-sm text-gray-400 mb-3">Cold email template</p>
          <pre className="rounded-lg border border-[#1f2028] bg-[#0a0a0f] p-4 text-xs whitespace-pre-wrap text-gray-300 mb-6">
            {outreachScript}
          </pre>
          <p className="text-sm text-gray-400 mb-3">LinkedIn opener</p>
          <pre className="rounded-lg border border-[#1f2028] bg-[#0a0a0f] p-4 text-xs whitespace-pre-wrap text-gray-300">
            {linkedinScript}
          </pre>
        </section>

        <section className="rounded-xl border border-[#1f2028] bg-[#111118] p-8">
          <h2 className="text-2xl font-bold mb-4">3) Weekly execution rhythm</h2>
          <ol className="space-y-3 text-sm text-gray-300 list-decimal list-inside">
            <li>Build a target list of 30 accounts and 1-2 decision makers each.</li>
            <li>Send 15 personalized messages/day and track replies.</li>
            <li>Book 5 calls, close 1 starter deal, then upsell full audit.</li>
          </ol>
          <div className="flex flex-wrap gap-3 mt-7">
            <a
              href="/audit"
              className="px-6 py-3 rounded-lg bg-cyan-400 text-[#0a0a0f] font-semibold hover:bg-cyan-300 transition-colors"
            >
              Use Audit Landing Page
            </a>
            <a
              href="/contact?intent=audit"
              className="px-6 py-3 rounded-lg border border-[#2d3044] text-gray-200 hover:border-cyan-400/40 hover:text-white transition-colors"
            >
              Talk to Sales
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
