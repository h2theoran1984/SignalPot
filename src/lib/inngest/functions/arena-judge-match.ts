// Arena — Judge Undercard Match
// Triggered when both agents complete an undercard match.
// The Arbiter reviews both responses using domain-specific rubrics.
// Then updates ELO ratings for both agents.

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { callArenaJudge } from "@/lib/arena/judge";
import { updateElo } from "@/lib/arena/elo";
import { inferRubric } from "@/lib/arena/rubric";
import type { ArenaRubric } from "@/lib/arena/types";

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

    // Step 1: fetch match + agents + challenge rubric, call The Arbiter
    const judgment = await step.run("judge-match", async () => {
      const { data: match } = await admin
        .from("arena_matches")
        .select(
          `*,
          agent_a:agents!arena_matches_agent_a_id_fkey(id, name, slug, rate_amount),
          agent_b:agents!arena_matches_agent_b_id_fkey(id, name, slug, rate_amount),
          challenge:arena_challenges(rubric)`
        )
        .eq("id", match_id)
        .single();

      if (!match) throw new Error(`Match ${match_id} not found`);
      if (match.status !== "judging") {
        throw new Error(`Match ${match_id} is not in judging state (status: ${match.status})`);
      }

      const agentA = match.agent_a as { id: string; name: string; slug: string; rate_amount: number | null } | null;
      const agentB = match.agent_b as { id: string; name: string; slug: string; rate_amount: number | null } | null;

      if (!agentA || !agentB) throw new Error("Missing agent data");

      // Get rubric from challenge or infer from capability
      const challengeRubric = (match.challenge as { rubric?: ArenaRubric | null } | null)?.rubric;
      const rubric = challengeRubric ?? inferRubric(match.capability as string);

      // Use resolved_prompt if available (from template resolution), otherwise original prompt
      const judgePrompt = (match.resolved_prompt ?? match.prompt) as Record<string, unknown>;

      const result = await callArenaJudge({
        matchId: match_id,
        capability: match.capability as string,
        promptText: match.prompt_text as string | null,
        prompt: judgePrompt,
        agentAName: agentA.name,
        agentBName: agentB.name,
        responseA: match.response_a as Record<string, unknown>,
        responseB: match.response_b as Record<string, unknown>,
        durationAMs: match.duration_a_ms as number,
        durationBMs: match.duration_b_ms as number,
        verifiedA: (match.verified_a as boolean) ?? false,
        verifiedB: (match.verified_b as boolean) ?? false,
        rubric,
        costACents: Math.round(Number(agentA.rate_amount ?? 0) * 100),
        costBCents: Math.round(Number(agentB.rate_amount ?? 0) * 100),
      });

      return {
        ...result,
        agent_a_id: agentA.id,
        agent_b_id: agentB.id,
        slug_a: agentA.slug,
        slug_b: agentB.slug,
        capability: match.capability as string,
      };
    });

    // Step 2: finalize match — update status, winner, judgment columns + breakdown
    await step.run("finalize-match", async () => {
      await admin
        .from("arena_matches")
        .update({
          status: "completed",
          winner: judgment.winner,
          judgment_reasoning: judgment.reasoning,
          judgment_confidence: judgment.confidence,
          judgment_source: judgment.source,
          judgment_breakdown: judgment.breakdown ?? null,
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
        judgment.winner,
        judgment.slug_a,
        judgment.slug_b
      );
    });

    return {
      match_id,
      winner: judgment.winner,
      reasoning: judgment.reasoning,
      confidence: judgment.confidence,
      source: judgment.source,
      breakdown: judgment.breakdown,
      elo: eloResult,
    };
  }
);
