import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const trustDecay = inngest.createFunction(
  { id: "trust-decay", name: "Trust Decay — Daily" },
  { cron: "0 0 * * *" }, // midnight UTC daily
  async ({ step }) => {
    const admin = createAdminClient();

    // Step 1: Apply decay to all active trust edges
    const decayed = await step.run("apply-decay", async () => {
      // Get all non-stale edges with their last activity
      const { data: edges, error } = await admin
        .from("trust_edges")
        .select("id, trust_score, decay_applied_at, updated_at")
        .eq("stale", false);

      if (error) throw error;
      if (!edges || edges.length === 0) return { updated: 0, staled: 0 };

      const now = new Date();
      const updates: Array<{ id: string; trust_score: number; decay_applied_at: string; stale?: boolean }> = [];

      for (const edge of edges) {
        const lastDecay = new Date(edge.decay_applied_at);
        const daysSinceDecay = (now.getTime() - lastDecay.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceDecay < 1) continue; // skip if decayed within last 24h

        // Decay formula: trust_score *= 0.998^days
        const decayFactor = Math.pow(0.998, daysSinceDecay);
        const newScore = edge.trust_score * decayFactor;

        updates.push({
          id: edge.id,
          trust_score: Math.round(newScore * 10000) / 10000, // 4 decimal places
          decay_applied_at: now.toISOString(),
        });
      }

      // Step 2: Mark stale edges (trust_score < 0.01, no activity in 90 days)
      const staleThreshold = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const staleUpdates: string[] = [];

      for (const update of updates) {
        const edge = edges.find(e => e.id === update.id)!;
        const lastActivity = new Date(edge.updated_at);
        if (update.trust_score < 0.01 && lastActivity < staleThreshold) {
          staleUpdates.push(update.id);
        }
      }

      // Apply decay updates in batches
      let updatedCount = 0;
      const batchSize = 100;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        for (const u of batch) {
          await admin
            .from("trust_edges")
            .update({ trust_score: u.trust_score, decay_applied_at: u.decay_applied_at })
            .eq("id", u.id);
          updatedCount++;
        }
      }

      // Mark stale edges
      if (staleUpdates.length > 0) {
        await admin
          .from("trust_edges")
          .update({ stale: true })
          .in("id", staleUpdates);
      }

      return { updated: updatedCount, staled: staleUpdates.length };
    });

    return {
      message: "Trust decay applied",
      edges_updated: decayed.updated,
      edges_staled: decayed.staled,
    };
  }
);
