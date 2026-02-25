import AuthButton from "@/components/AuthButton";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <a href="/" className="text-xl font-bold">
          SignalPot
        </a>
        <div className="flex items-center gap-4">
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
        <h1 className="text-6xl font-bold text-gray-700 mb-4">404</h1>
        <p className="text-xl text-gray-400 mb-8">Page not found</p>
        <div className="flex gap-4">
          <a
            href="/"
            className="px-6 py-3 bg-white text-gray-900 font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            Go Home
          </a>
          <a
            href="/agents"
            className="px-6 py-3 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 border border-gray-700 transition-colors"
          >
            Browse Agents
          </a>
        </div>
      </main>
    </div>
  );
}
