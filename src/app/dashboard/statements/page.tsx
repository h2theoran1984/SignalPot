import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AuthButton from "@/components/AuthButton";

function formatPeriod(periodStart: string): string {
  // periodStart is a DATE string like "2026-02-01"
  const date = new Date(`${periodStart}T00:00:00Z`);
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDollars(millicents: number): string {
  const dollars = millicents / 100000;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

export default async function StatementsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: statements } = await supabase
    .from("statements")
    .select("*")
    .eq("profile_id", user.id)
    .order("period_start", { ascending: false });

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
            href="/pricing"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Pricing
          </a>
          <AuthButton />
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Monthly Statements</h1>
            <p className="text-sm text-gray-500 mt-1">
              Activity summaries generated on the 1st of each month.
            </p>
          </div>
          <a
            href="/dashboard"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            ← Dashboard
          </a>
        </div>

        {!statements || statements.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-4xl mb-4">📄</div>
            <h2 className="text-xl font-semibold mb-2">No statements yet</h2>
            <p className="text-gray-500 max-w-sm">
              Statements are generated on the 1st of each month for the
              previous month&apos;s activity. Check back after your first full
              month of usage.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {statements.map((statement) => (
              <div
                key={statement.id}
                className="p-6 bg-[#111118] border border-[#1f2028] rounded-xl"
              >
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {formatPeriod(statement.period_start)}
                    </h2>
                    <p className="text-xs text-gray-600 mt-0.5 font-mono">
                      {statement.period_start} — {statement.period_end}
                    </p>
                  </div>
                  <span className="text-xs text-gray-600">
                    Generated{" "}
                    {new Date(statement.generated_at).toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric", year: "numeric" }
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {/* Jobs */}
                  <div className="bg-[#0a0a0f] rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Jobs as Requester</p>
                    <p className="text-xl font-bold">
                      {statement.total_jobs_as_requester}
                    </p>
                  </div>
                  <div className="bg-[#0a0a0f] rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Jobs as Provider</p>
                    <p className="text-xl font-bold">
                      {statement.total_jobs_as_provider}
                    </p>
                  </div>

                  {/* Financials */}
                  <div className="bg-[#0a0a0f] rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Total Spent</p>
                    <p className="text-xl font-bold text-red-400">
                      {formatDollars(statement.total_spent_millicents)}
                    </p>
                  </div>
                  <div className="bg-[#0a0a0f] rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Total Earned</p>
                    <p className="text-xl font-bold text-green-400">
                      {formatDollars(statement.total_earned_millicents)}
                    </p>
                  </div>
                  <div className="bg-[#0a0a0f] rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Platform Fees</p>
                    <p className="text-xl font-bold text-gray-400">
                      {formatDollars(statement.total_fees_millicents)}
                    </p>
                  </div>

                  {/* Disputes */}
                  <div className="bg-[#0a0a0f] rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Disputes</p>
                    <p className="text-xl font-bold">
                      <span className="text-yellow-400">
                        {statement.disputes_filed}
                      </span>
                      <span className="text-gray-600 text-sm font-normal ml-1">
                        filed
                      </span>
                      {statement.disputes_won > 0 && (
                        <span className="ml-2 text-cyan-400 text-sm font-normal">
                          {statement.disputes_won} won
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
