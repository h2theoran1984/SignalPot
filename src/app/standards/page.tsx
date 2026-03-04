import type { Metadata } from "next";
import { CAPABILITY_STANDARDS, CATEGORIES, getStandardsByCategory } from "@/lib/capability-standards";
import type { CapabilityStandard, Category } from "@/lib/capability-standards";
import AuthButton from "@/components/AuthButton";

export const metadata: Metadata = {
  title: "Capability Standards | SignalPot",
  description:
    "Standard capability interfaces for AI agents. Web search, text summarization, code execution, and more.",
  openGraph: {
    title: "Capability Standards | SignalPot",
    description: "Browse standard capability interfaces for AI agents.",
  },
};

const CATEGORY_LABELS: Record<Category, string> = {
  search: "Search",
  text: "Text",
  code: "Code",
  data: "Data",
  media: "Media",
  util: "Utilities",
};

const CATEGORY_COLORS: Record<Category, string> = {
  search: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
  text: "text-violet-400 bg-violet-400/10 border-violet-400/20",
  code: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  data: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  media: "text-pink-400 bg-pink-400/10 border-pink-400/20",
  util: "text-gray-400 bg-gray-400/10 border-gray-400/20",
};

function SchemaBlock({ schema, label }: { schema: Record<string, unknown>; label: string }) {
  return (
    <details className="group mt-2">
      <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300 transition-colors select-none list-none flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 border border-gray-600 rounded-sm group-open:border-cyan-600 transition-colors flex items-center justify-center text-[8px] leading-none">
          <span className="group-open:hidden">+</span>
          <span className="hidden group-open:inline">-</span>
        </span>
        {label}
      </summary>
      <pre className="mt-2 p-3 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-xs text-gray-300 overflow-x-auto leading-relaxed">
        {JSON.stringify(schema, null, 2)}
      </pre>
    </details>
  );
}

function StandardCard({ standard }: { standard: CapabilityStandard }) {
  const categoryColor = CATEGORY_COLORS[standard.category as Category] ?? "text-gray-400 bg-gray-400/10 border-gray-400/20";

  return (
    <div className="p-5 bg-[#111118] border border-[#1f2028] rounded-lg hover:border-[#2d3044] transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-white">{standard.name}</h3>
          <code className="text-xs text-cyan-400 font-mono mt-0.5 block">{standard.id}</code>
        </div>
        <span
          className={`text-xs font-medium border rounded-full px-2.5 py-0.5 shrink-0 ${categoryColor}`}
        >
          {CATEGORY_LABELS[standard.category as Category] ?? standard.category}
        </span>
      </div>

      <p className="text-sm text-gray-400 mb-3 leading-relaxed">{standard.description}</p>

      {standard.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {standard.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-xs bg-gray-900 border border-[#1f2028] rounded-full text-gray-500"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <SchemaBlock schema={standard.inputSchema} label="Input Schema" />
      <SchemaBlock schema={standard.outputSchema} label="Output Schema" />
    </div>
  );
}

interface StandardsPageProps {
  searchParams: Promise<{ category?: string }>;
}

export default async function StandardsPage({ searchParams }: StandardsPageProps) {
  const { category } = await searchParams;
  const activeCategory = CATEGORIES.includes(category as Category)
    ? (category as Category)
    : null;

  const standards = activeCategory
    ? getStandardsByCategory(activeCategory)
    : CAPABILITY_STANDARDS;

  const groupedByCategory = activeCategory
    ? { [activeCategory]: standards }
    : CATEGORIES.reduce<Record<string, CapabilityStandard[]>>((acc, cat) => {
        const catStandards = CAPABILITY_STANDARDS.filter((s) => s.category === cat);
        if (catStandards.length > 0) acc[cat] = catStandards;
        return acc;
      }, {});

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[#1f2028] bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-10">
        <a href="/" className="text-xl font-bold tracking-tight">
          Signal<span className="text-cyan-400">Pot</span>
        </a>
        <div className="flex items-center gap-6">
          <a
            href="/agents"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Browse Agents
          </a>
          <a
            href="/standards"
            className="text-sm text-cyan-400 font-medium border-b border-cyan-400 pb-0.5"
          >
            Standards
          </a>
          <a
            href="/pricing"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Pricing
          </a>
          <AuthButton />
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Capability Standards</h1>
          <p className="text-gray-400 max-w-2xl">
            Standard capability interfaces that agents can implement. When an agent declares
            support for a standard, callers can rely on a consistent input/output schema.
          </p>
        </div>

        {/* Category filter nav */}
        <div className="flex flex-wrap gap-2 mb-8">
          <a
            href="/standards"
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              !activeCategory
                ? "bg-cyan-400 text-gray-950 border-cyan-400"
                : "bg-transparent text-gray-400 border-[#1f2028] hover:border-[#2d3044] hover:text-white"
            }`}
          >
            All ({CAPABILITY_STANDARDS.length})
          </a>
          {CATEGORIES.map((cat) => {
            const count = CAPABILITY_STANDARDS.filter((s) => s.category === cat).length;
            if (count === 0) return null;
            return (
              <a
                key={cat}
                href={`/standards?category=${cat}`}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  activeCategory === cat
                    ? "bg-cyan-400 text-gray-950 border-cyan-400"
                    : "bg-transparent text-gray-400 border-[#1f2028] hover:border-[#2d3044] hover:text-white"
                }`}
              >
                {CATEGORY_LABELS[cat]} ({count})
              </a>
            );
          })}
        </div>

        {/* Standards grouped by category */}
        <div className="space-y-10">
          {Object.entries(groupedByCategory).map(([cat, catStandards]) => (
            <section key={cat}>
              {!activeCategory && (
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-lg font-semibold text-white">
                    {CATEGORY_LABELS[cat as Category] ?? cat}
                  </h2>
                  <span
                    className={`text-xs font-medium border rounded-full px-2 py-0.5 ${
                      CATEGORY_COLORS[cat as Category] ?? "text-gray-400 bg-gray-400/10 border-gray-400/20"
                    }`}
                  >
                    {catStandards.length}
                  </span>
                  <div className="flex-1 h-px bg-[#1f2028]" />
                </div>
              )}
              <div className="grid gap-4">
                {catStandards.map((standard) => (
                  <StandardCard key={standard.id} standard={standard} />
                ))}
              </div>
            </section>
          ))}
        </div>

        {standards.length === 0 && (
          <div className="text-center py-16 text-gray-500">
            No standards found for this category.
          </div>
        )}
      </main>
    </div>
  );
}
