"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function NewDisputeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get("job_id") ?? "";

  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setError("No job specified. Please go back to your dashboard and click Dispute on a completed job.");
    }
  }, [jobId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, reason }),
      });

      const data = await res.json();

      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : data.error?.formErrors?.[0] ??
              data.error?.fieldErrors?.reason?.[0] ??
              "Failed to file dispute";
        setError(msg);
        return;
      }

      router.push(`/disputes/${data.dispute.id}`);
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[#1f2028] bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-10">
        <a href="/" className="text-xl font-bold tracking-tight">
          Signal<span className="text-cyan-400">Pot</span>
        </a>
        <div className="flex items-center gap-6">
          <a
            href="/dashboard"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Dashboard
          </a>
          <a
            href="/disputes"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            My Disputes
          </a>
        </div>
      </nav>

      <main className="max-w-xl mx-auto px-4 py-12">
        <div className="mb-8">
          <a
            href="/dashboard"
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← Back to dashboard
          </a>
          <h1 className="text-2xl font-bold mt-3 mb-1">File a Dispute</h1>
          <p className="text-sm text-gray-500">
            Disputes must be filed within 72 hours of job completion. A deposit
            of 2x the job cost will be held and returned if your dispute is
            upheld.
          </p>
        </div>

        {jobId && (
          <div className="mb-6 p-3 bg-[#111118] border border-[#1f2028] rounded-lg">
            <span className="text-xs text-gray-500">Job ID: </span>
            <span className="text-xs font-mono text-gray-300">{jobId}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="reason"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Reason for dispute
            </label>
            <textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={6}
              minLength={20}
              maxLength={2000}
              required
              disabled={!jobId || loading}
              placeholder="Describe what went wrong. Please be specific — include what you expected vs. what was returned. Minimum 20 characters."
              className="w-full px-4 py-3 bg-[#111118] border border-[#1f2028] rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50 resize-none transition-colors"
            />
            <div className="flex justify-between mt-1">
              <span
                className={`text-xs ${reason.length < 20 ? "text-gray-600" : "text-gray-500"}`}
              >
                {reason.length < 20
                  ? `${20 - reason.length} more characters required`
                  : `${reason.length} / 2000`}
              </span>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-lg">
            <p className="text-xs text-yellow-400/80">
              <strong className="text-yellow-400">Deposit notice:</strong> Filing
              a dispute requires a hold of 2x the job cost from your credit
              balance. This is returned if your dispute is upheld. If your
              dispute is rejected, the deposit is forfeited.
            </p>
          </div>

          <button
            type="submit"
            disabled={!jobId || loading || reason.length < 20}
            className="w-full py-3 bg-cyan-400 text-gray-950 rounded-lg font-semibold text-sm hover:bg-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Filing dispute…" : "File Dispute"}
          </button>
        </form>
      </main>
    </div>
  );
}

export default function NewDisputePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
          <div className="text-gray-500 text-sm">Loading…</div>
        </div>
      }
    >
      <NewDisputeForm />
    </Suspense>
  );
}
