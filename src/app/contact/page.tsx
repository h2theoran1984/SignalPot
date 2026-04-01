import SiteNav from "@/components/SiteNav";
import AuditIntakeForm from "@/components/AuditIntakeForm";

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

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />
      <main className="max-w-2xl mx-auto px-4 py-16">
        <AuditIntakeForm packageName={packageName} initialIntent={intent} />
      </main>
    </div>
  );
}
