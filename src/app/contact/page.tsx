import SiteNav from "@/components/SiteNav";

type ContactPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function asText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function titleForIntent(intent: string): string {
  if (intent.startsWith("audit")) return "Agent Reliability Audit";
  return "SignalPot Sales";
}

export default async function ContactPage({ searchParams }: ContactPageProps) {
  const params = (await searchParams) ?? {};
  const intent = asText(params.intent).trim().toLowerCase();
  const packageName = titleForIntent(intent);
  const mailto = `mailto:support@signalpot.dev?subject=${encodeURIComponent(`${packageName} inquiry`)}`;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />
      <main className="max-w-2xl mx-auto px-4 py-16">
        <section className="rounded-xl border border-[#1f2028] bg-[#111118] p-8">
          <p className="text-xs tracking-[0.2em] uppercase text-cyan-300 mb-3">Sales Contact</p>
          <h1 className="text-3xl font-bold mb-3">Let&apos;s scope your {packageName.toLowerCase()}.</h1>
          <p className="text-gray-300 mb-6">
            Send a short note with your stack, primary risk concern, and timeline. We reply with scope and next steps.
          </p>
          <div className="space-y-3 mb-8">
            <div className="rounded-lg border border-[#1f2028] bg-[#0a0a0f] px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Email</p>
              <p className="font-medium">support@signalpot.dev</p>
            </div>
            <div className="rounded-lg border border-[#1f2028] bg-[#0a0a0f] px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Suggested subject</p>
              <p className="font-medium">{packageName} inquiry</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href={mailto}
              className="px-6 py-3 rounded-lg bg-cyan-400 text-[#0a0a0f] font-semibold hover:bg-cyan-300 transition-colors"
            >
              Open Email Draft
            </a>
            <a
              href="/audit"
              className="px-6 py-3 rounded-lg border border-[#2d3044] text-gray-200 hover:border-cyan-400/40 hover:text-white transition-colors"
            >
              Back to Audit Details
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
