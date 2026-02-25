export default function AgentsLoading() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div className="text-xl font-bold">SignalPot</div>
        <div className="flex items-center gap-4">
          <div className="h-4 w-24 bg-gray-800 rounded animate-pulse" />
          <div className="h-9 w-20 bg-gray-800 rounded-lg animate-pulse" />
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="h-9 w-32 bg-gray-800 rounded animate-pulse" />
          <div className="h-10 w-36 bg-gray-800 rounded-lg animate-pulse" />
        </div>

        <div className="h-12 w-full bg-gray-900 border border-gray-800 rounded-lg mb-6 animate-pulse" />

        <div className="grid gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="p-5 bg-gray-900 border border-gray-800 rounded-lg animate-pulse"
            >
              <div className="h-5 w-48 bg-gray-800 rounded mb-3" />
              <div className="h-4 w-72 bg-gray-800 rounded mb-3" />
              <div className="flex gap-2">
                <div className="h-5 w-16 bg-gray-800 rounded-full" />
                <div className="h-5 w-20 bg-gray-800 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
