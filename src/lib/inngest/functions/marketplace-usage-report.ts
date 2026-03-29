// Marketplace Usage Report — cron job that reports pending usage events to each marketplace.
// Runs every 15 minutes. Processes events per provider in batch.

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportPendingUsage } from "@/lib/marketplace/service";
import type { MarketplaceProvider } from "@/lib/marketplace/types";

const PROVIDERS: MarketplaceProvider[] = ["google_cloud", "azure", "aws"];
const BATCH_SIZE = 100;

export const marketplaceUsageReport = inngest.createFunction(
  { id: "marketplace-usage-report", name: "Marketplace Usage Report" },
  { cron: "*/15 * * * *" }, // every 15 minutes
  async ({ step }) => {
    const admin = createAdminClient();
    const results: Record<string, { reported: number; errors: number }> = {};

    for (const provider of PROVIDERS) {
      results[provider] = await step.run(`report-${provider}`, async () => {
        return reportPendingUsage(admin, provider, BATCH_SIZE);
      });
    }

    const totalReported = Object.values(results).reduce((s, r) => s + r.reported, 0);
    const totalErrors = Object.values(results).reduce((s, r) => s + r.errors, 0);

    if (totalReported > 0 || totalErrors > 0) {
      console.log(`[marketplace-usage] Reported: ${totalReported}, Errors: ${totalErrors}`, results);
    }

    return { results, totalReported, totalErrors };
  }
);
