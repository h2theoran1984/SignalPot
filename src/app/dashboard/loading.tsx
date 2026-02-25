export default function DashboardLoading() {
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
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-full bg-gray-800 animate-pulse" />
          <div>
            <div className="h-7 w-40 bg-gray-800 rounded mb-2 animate-pulse" />
            <div className="h-4 w-56 bg-gray-800 rounded animate-pulse" />
          </div>
        </div>

        <div className="h-7 w-32 bg-gray-800 rounded mb-4 animate-pulse" />

        <div className="grid gap-3 mb-8">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between p-4 bg-gray-900 border border-gray-800 rounded-lg animate-pulse"
            >
              <div className="h-5 w-48 bg-gray-800 rounded" />
              <div className="h-5 w-16 bg-gray-800 rounded" />
            </div>
          ))}
        </div>

        <div className="h-7 w-36 bg-gray-800 rounded mb-4 animate-pulse" />

        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between p-4 bg-gray-900 border border-gray-800 rounded-lg animate-pulse"
            >
              <div className="h-4 w-64 bg-gray-800 rounded" />
              <div className="flex gap-3">
                <div className="h-5 w-20 bg-gray-800 rounded" />
                <div className="h-5 w-12 bg-gray-800 rounded" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
