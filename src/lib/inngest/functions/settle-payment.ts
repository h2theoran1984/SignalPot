import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";

// Async settlement function — triggered when a job completes.
// Moves the settle_job_payment RPC call off the synchronous PATCH /api/jobs/[id] path.
export const settlePayment = inngest.createFunction(
  {
    id: "settle-payment",
    name: "Settle Job Payment",
    retries: 3,
  },
  { event: "job/completed" },
  async ({ event, step }) => {
    const { job_id, platform_fee_pct } = event.data;

    const result = await step.run("settle-via-rpc", async () => {
      const admin = createAdminClient();
      const { error } = await admin.rpc("settle_job_payment", {
        p_job_id: job_id,
        p_platform_fee_pct: platform_fee_pct,
      });

      if (error) {
        if (error.message?.includes("INSUFFICIENT_BALANCE")) {
          // Non-retriable — caller doesn't have funds. Log and stop.
          console.warn(`[settle-payment] Insufficient balance for job ${job_id}`);
          return { settled: false, reason: "INSUFFICIENT_BALANCE" };
        }
        // Any other DB error — throw so Inngest retries
        throw new Error(`settle_job_payment failed: ${error.message}`);
      }

      return { settled: true };
    });

    return result;
  }
);
