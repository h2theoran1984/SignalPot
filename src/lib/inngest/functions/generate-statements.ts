import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const generateStatements = inngest.createFunction(
  { id: "generate-statements", name: "Generate Monthly Statements" },
  { cron: "0 1 1 * *" },
  async ({ step }) => {
    const admin = createAdminClient();

    const { periodStart, periodEnd } = await step.run("compute-period", async () => {
      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return {
        periodStart: firstOfLastMonth.toISOString().split("T")[0],
        periodEnd: firstOfMonth.toISOString().split("T")[0],
      };
    });

    const profiles = await step.run("fetch-active-profiles", async () => {
      const { data } = await admin.from("profiles").select("id");
      return (data ?? []).map((p: { id: string }) => p.id);
    });

    await step.run("generate-all-statements", async () => {
      for (const profileId of profiles) {
        // Jobs as requester (completed in period)
        const { data: asRequester } = await admin
          .from("jobs")
          .select("id, cost")
          .eq("requester_profile_id", profileId)
          .eq("status", "completed")
          .gte("completed_at", periodStart)
          .lt("completed_at", periodEnd);

        // Jobs as provider — find this profile's agents first
        const { data: myAgents } = await admin
          .from("agents")
          .select("id")
          .eq("owner_id", profileId);
        const agentIds = (myAgents ?? []).map((a: { id: string }) => a.id);

        const { data: asProvider } =
          agentIds.length > 0
            ? await admin
                .from("jobs")
                .select("id, cost")
                .in("provider_agent_id", agentIds)
                .eq("status", "completed")
                .gte("completed_at", periodStart)
                .lt("completed_at", periodEnd)
            : { data: [] };

        // Disputes filed by this profile in the period
        const { data: disputesFiled } = await admin
          .from("disputes")
          .select("id, resolution")
          .eq("filed_by_profile_id", profileId)
          .eq("status", "resolved")
          .gte("filed_at", periodStart)
          .lt("filed_at", periodEnd);

        // cost on jobs is in dollars; convert to millicents (cost * 100000)
        const totalSpent = (asRequester ?? []).reduce(
          (sum: number, j: { cost: number | null }) =>
            sum + Math.round((j.cost ?? 0) * 100000),
          0
        );
        // Provider receives ~88% (after 10% platform fee + 2% reserve)
        const totalEarned = (asProvider ?? []).reduce(
          (sum: number, j: { cost: number | null }) =>
            sum + Math.round((j.cost ?? 0) * 100000 * 0.88),
          0
        );
        // Fees are the 12% withheld from provider payments
        const totalFees = (asProvider ?? []).reduce(
          (sum: number, j: { cost: number | null }) =>
            sum + Math.round((j.cost ?? 0) * 100000 * 0.12),
          0
        );

        // Only insert if there was any activity
        const hasActivity =
          (asRequester ?? []).length > 0 ||
          (asProvider ?? []).length > 0 ||
          (disputesFiled ?? []).length > 0;

        if (!hasActivity) continue;

        await admin.from("statements").upsert(
          {
            profile_id: profileId,
            period_start: periodStart,
            period_end: periodEnd,
            total_jobs_as_requester: (asRequester ?? []).length,
            total_jobs_as_provider: (asProvider ?? []).length,
            total_spent_millicents: totalSpent,
            total_earned_millicents: totalEarned,
            total_fees_millicents: totalFees,
            disputes_filed: (disputesFiled ?? []).length,
            // requester filed the dispute; 'upheld' = requester wins (provider loses)
            // for a statement from the requester's perspective, disputes_won = upheld
            disputes_won: (disputesFiled ?? []).filter(
              (d: { resolution: string | null }) => d.resolution === "upheld"
            ).length,
            generated_at: new Date().toISOString(),
          },
          { onConflict: "profile_id,period_start" }
        );
      }
      return { processed: profiles.length };
    });

    return {
      message: "Statements generated",
      period: `${periodStart} to ${periodEnd}`,
    };
  }
);
