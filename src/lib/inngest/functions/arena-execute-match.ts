import { inngest } from "@/lib/inngest/client";
import { setupMatch, callSingleAgent, finalizeMatch } from "@/lib/arena/engine";
import type { Agent } from "@/lib/types";

/**
 * Async match execution — each agent call runs in its own Inngest step,
 * meaning each gets its own Vercel function invocation (up to 60s each).
 * No shared timeout pressure. Agents can take as long as they need.
 *
 * Steps:
 *   1. setup    — load match, resolve template, mark running
 *   2. call-a   — call Agent A (own invocation)
 *   3. call-b   — call Agent B (own invocation)
 *   4. finalize — save results, transition to judging/voting/completed
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

    // Step 1: Setup — load match, agents, resolve template
    const setup = await step.run("setup", async () => {
      const result = await setupMatch(match_id);
      if (!result) return null;
      // Serialize agents for passing between steps
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
      return { match_id, status: "skipped", reason: "Match not found or not pending" };
    }

    // Step 2: Call Agent A (own Vercel invocation — full 60s)
    const resultA = await step.run("call-agent-a", async () => {
      return callSingleAgent(
        setup.agentA as Agent,
        setup.capability,
        setup.prompt,
        setup.matchId,
        "a"
      );
    });

    // Step 3: Call Agent B (own Vercel invocation — full 60s)
    const resultB = await step.run("call-agent-b", async () => {
      return callSingleAgent(
        setup.agentB as Agent,
        setup.capability,
        setup.prompt,
        setup.matchId,
        "b"
      );
    });

    // Step 4: Finalize — save results, determine outcome
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

    // Step 5: Fire judging event if both agents succeeded (undercard)
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
