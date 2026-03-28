import { inngest } from "@/lib/inngest/client";
import { setupMatch, fireAgentCall, finalizeMatch } from "@/lib/arena/engine";
import type { Agent } from "@/lib/types";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "https://www.signalpot.dev";

/**
 * Async match execution — fire-and-forget with callbacks.
 *
 * Steps:
 *   1. setup       — load match, resolve template, mark running
 *   2. fire-agents — send requests to both agents (returns immediately)
 *   3. wait-a      — wait for Agent A's callback event (no timeout pressure)
 *   4. wait-b      — wait for Agent B's callback event (no timeout pressure)
 *   5. finalize    — save results, transition to judging
 *   6. trigger     — fire judging event if both succeeded
 *
 * Agents take however long they need. Inngest sleeps (free) until
 * each callback arrives. No Vercel timeout issues.
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

    // Step 2: Fire both agent calls (returns immediately — no waiting)
    const fired = await step.run("fire-agents", async () => {
      const callbackBase = SITE_URL;

      const [firedA, firedB] = await Promise.all([
        fireAgentCall(setup.agentA as Agent, setup.capability, setup.prompt, setup.matchId, "a", callbackBase),
        fireAgentCall(setup.agentB as Agent, setup.capability, setup.prompt, setup.matchId, "b", callbackBase),
      ]);

      return { jobIdA: firedA.jobId, jobIdB: firedB.jobId };
    });

    // Step 3: Wait for Agent A's callback (up to 5 minutes)
    const responseA = await step.waitForEvent("wait-agent-a", {
      event: "arena/agent.responded",
      match: `async.data.match_id == '${setup.matchId}' && async.data.side == 'a'`,
      timeout: "5m",
    });

    // Step 4: Wait for Agent B's callback (up to 5 minutes)
    const responseB = await step.waitForEvent("wait-agent-b", {
      event: "arena/agent.responded",
      match: `async.data.match_id == '${setup.matchId}' && async.data.side == 'b'`,
      timeout: "5m",
    });

    // Step 5: Finalize
    const resultA = responseA?.data?.error
      ? { jobId: fired.jobIdA, error: responseA.data.error }
      : responseA
        ? { jobId: fired.jobIdA, result: { response: responseA.data.response, durationMs: responseA.data.duration_ms, verified: responseA.data.verified } }
        : { jobId: fired.jobIdA, error: "Agent A timed out (no callback received)" };

    const resultB = responseB?.data?.error
      ? { jobId: fired.jobIdB, error: responseB.data.error }
      : responseB
        ? { jobId: fired.jobIdB, result: { response: responseB.data.response, durationMs: responseB.data.duration_ms, verified: responseB.data.verified } }
        : { jobId: fired.jobIdB, error: "Agent B timed out (no callback received)" };

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

    // Step 6: Trigger judging if both succeeded
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
