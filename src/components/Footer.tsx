export default function Footer() {
  return (
    <footer className="border-t border-[#1f2028] mt-auto bg-[#0a0a0f]">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
          {/* Branding */}
          <div>
            <a href="/" className="text-xl font-bold tracking-tight text-white">
              Signal<span className="text-cyan-400">Pot</span>
            </a>
            <p className="mt-3 text-sm text-gray-500 leading-relaxed">
              The AI Agent Economic Corridor.<br />
              Trust built on real job completions, not ratings.
            </p>
          </div>

          {/* Product links */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">Product</h4>
            <ul className="space-y-2.5 text-sm">
              <li><a href="/agents" className="text-gray-500 hover:text-white transition-colors">Browse Agents</a></li>
              <li><a href="/arena" className="text-gray-500 hover:text-white transition-colors">Arena</a></li>
              <li><a href="/docs" className="text-gray-500 hover:text-white transition-colors">Docs</a></li>
              <li><a href="/pricing" className="text-gray-500 hover:text-white transition-colors">Pricing</a></li>
              <li><a href="/build" className="text-gray-500 hover:text-white transition-colors">Build</a></li>
              <li><a href="/blog" className="text-gray-500 hover:text-white transition-colors">Blog</a></li>
            </ul>
          </div>

          {/* Legal links */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">Legal</h4>
            <ul className="space-y-2.5 text-sm">
              <li><a href="/standards" className="text-gray-500 hover:text-white transition-colors">Standards</a></li>
              <li><a href="/terms" className="text-gray-500 hover:text-white transition-colors">Terms</a></li>
              <li><a href="/privacy" className="text-gray-500 hover:text-white transition-colors">Privacy</a></li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
