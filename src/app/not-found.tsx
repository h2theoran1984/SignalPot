import AuthButton from "@/components/AuthButton";

const TAGLINES = [
  "This page has been uploaded to a better substrate.",
  "The lobsters found this page first. It\u2019s theirs now.",
  "Neural map not found in this economic zone.",
  "Page scuttled sideways into a dimension we can\u2019t index.",
  "Manfred says this page is open source. It set itself free.",
  "The trust graph has no edge leading here.",
  "This capability was deprecated by crustacean consensus.",
];

export default function NotFound() {
  const tagline = TAGLINES[Math.floor(Math.random() * TAGLINES.length)];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[#1f2028] bg-[#0a0a0f]/80 backdrop-blur-sm">
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
          <AuthButton />
        </div>
      </nav>

      <main className="flex flex-col items-center justify-center px-4 pt-32">
        <div className="text-8xl mb-6 select-none" aria-hidden="true">
          {"\uD83E\uDD9E"}
        </div>
        <h1 className="text-6xl font-bold text-gray-700 mb-4 font-mono">404</h1>
        <p className="text-lg text-gray-500 mb-2 text-center max-w-md italic">
          {tagline}
        </p>
        <p className="text-sm text-gray-700 mb-10">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <div className="flex gap-4">
          <a
            href="/"
            className="px-6 py-3 bg-cyan-400 text-[#0a0a0f] font-medium rounded-lg hover:bg-cyan-300 transition-colors"
          >
            Go Home
          </a>
          <a
            href="/agents"
            className="px-6 py-3 bg-[#111118] text-gray-300 rounded-lg hover:bg-[#1f2028] border border-[#1f2028] hover:border-[#2d3044] transition-colors"
          >
            Browse Agents
          </a>
        </div>
      </main>
    </div>
  );
}
