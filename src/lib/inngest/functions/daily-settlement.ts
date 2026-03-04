import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const dailySettlement = inngest.createFunction(
  { id: "daily-settlement", name: "Daily Net Settlement" },
  { cron: "0 2 * * *" },
  async ({ step }) => {
    const admin = createAdminClient();

    const summary = await step.run("aggregate-daily-revenue", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dayStart = new Date(
        yesterday.getFullYear(),
        yesterday.getMonth(),
        yesterday.getDate()
      ).toISOString();
      const dayEnd = new Date(
        yesterday.getFullYear(),
        yesterday.getMonth(),
        yesterday.getDate() + 1
      ).toISOString();

      // Platform revenue (fees collected)
      const { data: revenue } = await admin
        .from("platform_revenue")
        .select("amount_millicents")
        .gte("created_at", dayStart)
        .lt("created_at", dayEnd);

      // Dispute reserves collected
      const { data: reserves } = await admin
        .from("dispute_reserve")
        .select("amount_millicents")
        .gte("created_at", dayStart)
        .lt("created_at", dayEnd);

      const totalRevenue = (revenue ?? []).reduce(
        (s: number, r: { amount_millicents: number | null }) =>
          s + (r.amount_millicents ?? 0),
        0
      );
      const totalReserves = (reserves ?? []).reduce(
        (s: number, r: { amount_millicents: number | null }) =>
          s + (r.amount_millicents ?? 0),
        0
      );
      const jobCount = (revenue ?? []).length;

      return {
        date: dayStart.split("T")[0],
        job_count: jobCount,
        platform_revenue_millicents: totalRevenue,
        dispute_reserve_millicents: totalReserves,
        total_millicents: totalRevenue + totalReserves,
      };
    });

    // Log to console (could be stored in a settlement_ledger table in future)
    console.log("[daily-settlement]", JSON.stringify(summary));

    return summary;
  }
);
