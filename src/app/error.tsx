"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center px-4">
      <div className="text-5xl mb-4 select-none" aria-hidden="true">
        {"\uD83E\uDD9E"}
      </div>
      <h1 className="text-4xl font-bold mb-4">
        A lobster got into the pipeline
      </h1>
      <p className="text-gray-500 mb-8 text-center max-w-md">
        Something scuttled sideways. The trust graph is recalibrating.
      </p>
      <div className="flex gap-4">
        <button
          onClick={reset}
          className="px-6 py-3 bg-cyan-400 text-[#0a0a0f] font-medium rounded-lg hover:bg-cyan-300 transition-colors cursor-pointer"
        >
          Try Again
        </button>
        <a
          href="/"
          className="px-6 py-3 bg-[#111118] text-gray-300 rounded-lg hover:bg-[#1f2028] border border-[#1f2028] hover:border-[#2d3044] transition-colors"
        >
          Go Home
        </a>
      </div>
    </div>
  );
}
