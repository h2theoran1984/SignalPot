// Arena — Weekly Championship Bout Generator
// Runs every Friday at 6pm UTC via Inngest cron.
// For each capability with >=2 agents with >=3 matches played,
// creates a championship match between the top 2 ELO-ranked agents.

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const arenaChampionship = inngest.createFunction(
  {
    id: "arena-championship",
    name: "Arena — Weekly Championship Bout",
    retries: 0, // cron — don't retry
  },
  { cron: "0 18 * * FRI" },
  async ({ step }) => {
    const admin = createAdminClient();

    // Step 1: find contenders — top 2 agents per capability by ELO
    const bouts = await step.run("find-contenders", async () => {
      // Get all capabilities with >=2 agents with >=3 matches played
      const { data: ratings } = await admin
        .from("arena_ratings")
        .select("agent_id, capability, elo, matches_played")
        .gte("matches_played", 3)
        .order("elo", { ascending: false });

      if (!ratings || ratings.length === 0) return [];

      // Group by capability
      const byCapability: Record<
        string,
        Array<{ agent_id: string; elo: number; matches_played: number }>
      > = {};

      for (const r of ratings) {
        const cap = r.capability as string;
        if (!byCapability[cap]) byCapability[cap] = [];
        byCapability[cap].push({
          agent_id: r.agent_id as string,
          elo: r.elo as number,
          matches_played: r.matches_played as number,
        });
      }

      // For each capability with >=2 agents, pick top 2
      const matchups: Array<{
        capability: string;
        agent_a_id: string;
        agent_b_id: string;
        elo_a: number;
        elo_b: number;
      }> = [];

      for (const [capability, agents] of Object.entries(byCapability)) {
        if (agents.length < 2) continue;

        // Check if a championship for this capability is already running/voting
        const { data: existing } = await admin
          .from("arena_matches")
          .select("id")
          .eq("match_type", "championship")
          .eq("capability", capability)
          .in("status", ["pending", "running", "judging", "voting"])
          .limit(1);

        if (existing && existing.length > 0) {
          console.log(`[championship] Skipping ${capability} — active championship exists`);
          continue;
        }

        // Top 2 (already sorted by ELO desc)
        matchups.push({
          capability,
          agent_a_id: agents[0].agent_id,
          agent_b_id: agents[1].agent_id,
          elo_a: agents[0].elo,
          elo_b: agents[1].elo,
        });
      }

      return matchups;
    });

    if (bouts.length === 0) {
      return { created: 0, message: "No eligible capabilities for championship" };
    }

    // Step 2: create championship matches
    const created = await step.run("create-bouts", async () => {
      const createdMatches: Array<{ match_id: string; capability: string }> = [];

      for (const bout of bouts) {
        // We need a creator_id — use the platform system user or first admin
        // For now, use the owner of agent_a as creator (they're the higher-ranked)
        const { data: agentA } = await admin
          .from("agents")
          .select("owner_id, name, slug, capability_schema")
          .eq("id", bout.agent_a_id)
          .single();

        const { data: agentB } = await admin
          .from("agents")
          .select("name, slug")
          .eq("id", bout.agent_b_id)
          .single();

        if (!agentA || !agentB) continue;

        // Build championship prompt
        const prompt = {
          task: `Championship bout: demonstrate your ${bout.capability} capabilities at the highest level.`,
          context: "This is a weekly championship match between the top-ranked agents.",
        };

        const promptText = `Championship bout: ${agentA.name} vs ${agentB.name} — ${bout.capability}`;

        // Insert the championship match
        const { data: match, error } = await admin
          .from("arena_matches")
          .insert({
            creator_id: agentA.owner_id,
            agent_a_id: bout.agent_a_id,
            agent_b_id: bout.agent_b_id,
            capability: bout.capability,
            prompt,
            prompt_text: promptText,
            match_type: "championship",
            status: "pending",
          })
          .select("id")
          .single();

        if (error || !match) {
          console.error(`[championship] Failed to create bout for ${bout.capability}:`, error?.message);
          continue;
        }

        // Fire event to execute the match (existing flow handles it)
        await inngest.send({
          name: "arena/match.created",
          data: { match_id: match.id },
        });

        createdMatches.push({
          match_id: match.id as string,
          capability: bout.capability,
        });

        console.log(
          `[championship] Created bout: ${agentA.name} (ELO ${bout.elo_a}) vs ${agentB.name} (ELO ${bout.elo_b}) — ${bout.capability}`
        );
      }

      return createdMatches;
    });

    return {
      created: created.length,
      matches: created,
    };
  }
);
