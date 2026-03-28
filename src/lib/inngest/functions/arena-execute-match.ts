import { inngest } from "@/lib/inngest/client";
import { setupMatch, callSingleAgent, finalizeMatch } from "@/lib/arena/engine";
import type { Agent } from "@/lib/types";

/**
 * Async match execution — each agent call is its own Inngest step,
 * getting its own Vercel function invocation (60s on Pro).
 *
 * No artificial abort timers. Each agent gets Vercel's full 60s.
 * Inngest handles retry and orchestration between steps.
 */
export const arenaExecuteMatch = inngest.createFunction(
  {
    id: "arena-execute-match",
    name: "Arena — Execute Match",
    retries: 1,
  },
  { event: "arena/match.created" },
  async ({ event, step }) => {
    const { match_id } = event.data;

    // Step 1: Setup
    const setup = await step.run("setup", async () => {
      const result = await setupMatch(match_id);
      if (!result) return null;
      return {
        matchId: result.matchId,
        capability: result.capability,
        prompt: result.prompt,
        matchType: result.matchType,
        creatorId: result.creatorId,
        agentA: result.agentA,
        agentB: result.agentB,
      };
    });

    if (!setup) {
      return { match_id, status: "skipped" };
    }

    // Step 2: Call Agent A (own Vercel invocation — full 60s, no abort timer)
    const resultA = await step.run("call-agent-a", async () => {
      return callSingleAgent(
        setup.agentA as Agent,
        setup.capability,
        setup.prompt,
        setup.matchId,
        "a"
      );
    });

    // Step 3: Call Agent B (own Vercel invocation — full 60s, no abort timer)
    const resultB = await step.run("call-agent-b", async () => {
      return callSingleAgent(
        setup.agentB as Agent,
        setup.capability,
        setup.prompt,
        setup.matchId,
        "b"
      );
    });

    // Step 4: Finalize
    const outcome = await step.run("finalize", async () => {
      return finalizeMatch(
        setup.matchId,
        setup.agentA as Agent,
        setup.agentB as Agent,
        setup.matchType,
        setup.creatorId,
        resultA,
        resultB
      );
    });

    // Step 5: Trigger judging if both succeeded
    if (outcome.status === "judging") {
      await step.run("trigger-judging", async () => {
        await inngest.send({
          name: "arena/match.judging",
          data: { match_id: setup.matchId },
        });
      });
    }

    return { match_id, ...outcome };
  }
);
