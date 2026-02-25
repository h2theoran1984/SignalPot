"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4">
      <h1 className="text-4xl font-bold mb-4">Something went wrong</h1>
      <p className="text-gray-400 mb-8">
        An unexpected error occurred. Please try again.
      </p>
      <div className="flex gap-4">
        <button
          onClick={reset}
          className="px-6 py-3 bg-white text-gray-900 font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer"
        >
          Try Again
        </button>
        <a
          href="/"
          className="px-6 py-3 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 border border-gray-700 transition-colors"
        >
          Go Home
        </a>
      </div>
    </div>
  );
}
