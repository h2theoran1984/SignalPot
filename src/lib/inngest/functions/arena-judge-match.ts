// Arena — Judge Undercard Match
// Triggered when both agents complete an undercard match.
// The Arbiter reviews both responses and picks the winner.
// Then updates ELO ratings for both agents.

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { callArenaJudge } from "@/lib/arena/judge";
import { updateElo } from "@/lib/arena/elo";

export const arenaJudgeMatch = inngest.createFunction(
  {
    id: "arena-judge-match",
    name: "Arena — Judge Undercard Match",
    retries: 1,
  },
  { event: "arena/match.judging" },
  async ({ event, step }) => {
    const { match_id } = event.data;
    const admin = createAdminClient();

    // Step 1: fetch match + agents, call The Arbiter
    const judgment = await step.run("judge-match", async () => {
      const { data: match } = await admin
        .from("arena_matches")
        .select(
          `*,
          agent_a:agents!arena_matches_agent_a_id_fkey(id, name, slug),
          agent_b:agents!arena_matches_agent_b_id_fkey(id, name, slug)`
        )
        .eq("id", match_id)
        .single();

      if (!match) throw new Error(`Match ${match_id} not found`);
      if (match.status !== "judging") {
        throw new Error(`Match ${match_id} is not in judging state (status: ${match.status})`);
      }

      const agentA = match.agent_a as { id: string; name: string; slug: string } | null;
      const agentB = match.agent_b as { id: string; name: string; slug: string } | null;

      if (!agentA || !agentB) throw new Error("Missing agent data");

      const result = await callArenaJudge({
        matchId: match_id,
        capability: match.capability as string,
        promptText: match.prompt_text as string | null,
        prompt: match.prompt as Record<string, unknown>,
        agentAName: agentA.name,
        agentBName: agentB.name,
        responseA: match.response_a as Record<string, unknown>,
        responseB: match.response_b as Record<string, unknown>,
        durationAMs: match.duration_a_ms as number,
        durationBMs: match.duration_b_ms as number,
        verifiedA: (match.verified_a as boolean) ?? false,
        verifiedB: (match.verified_b as boolean) ?? false,
      });

      return {
        ...result,
        agent_a_id: agentA.id,
        agent_b_id: agentB.id,
        capability: match.capability as string,
      };
    });

    // Step 2: finalize match — update status, winner, judgment columns
    await step.run("finalize-match", async () => {
      await admin
        .from("arena_matches")
        .update({
          status: "completed",
          winner: judgment.winner,
          judgment_reasoning: judgment.reasoning,
          judgment_confidence: judgment.confidence,
          judgment_source: judgment.source,
          completed_at: new Date().toISOString(),
        })
        .eq("id", match_id);
    });

    // Step 3: update ELO ratings for both agents
    const eloResult = await step.run("update-elo", async () => {
      return updateElo(
        judgment.agent_a_id,
        judgment.agent_b_id,
        judgment.capability,
        judgment.winner
      );
    });

    return {
      match_id,
      winner: judgment.winner,
      reasoning: judgment.reasoning,
      confidence: judgment.confidence,
      source: judgment.source,
      elo: eloResult,
    };
  }
);
