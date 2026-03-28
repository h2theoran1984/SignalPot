import { inngest } from "@/lib/inngest/client";
import { setupMatch, fireAgentCall, finalizeMatch } from "@/lib/arena/engine";
import type { Agent } from "@/lib/types";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://signalpot.dev";

/**
 * Async match execution — fire-and-forget + waitForEvent pattern.
 *
 * Instead of blocking a Vercel function while agents think, we:
 * 1. Fire both agent requests with callback URLs (returns immediately)
 * 2. Wait for callback events (up to 15 min — no Vercel timeout pressure)
 * 3. Finalize when both agents respond (or timeout)
 *
 * The callback endpoint (POST /api/arena/matches/[id]/callback) fires
 * the "arena/agent.responded" event, which wakes up the waitForEvent.
 */
export const arenaExecuteMatch = inngest.createFunction(
  {
    id: "arena-execute-match",
    name: "Arena — Execute Match (Async)",
    retries: 1,
  },
  { event: "arena/match.created" },
  async ({ event, step }) => {
    const { match_id } = event.data;

    // Step 1: Setup — load match, agents, resolve template, mark running
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

    // Step 2: Fire Agent A (returns immediately — no blocking)
    const fireA = await step.run("fire-agent-a", async () => {
      return fireAgentCall(
        setup.agentA as Agent,
        setup.capability,
        setup.prompt,
        setup.matchId,
        "a",
        SITE_URL
      );
    });

    // Step 3: Fire Agent B (returns immediately — no blocking)
    const fireB = await step.run("fire-agent-b", async () => {
      return fireAgentCall(
        setup.agentB as Agent,
        setup.capability,
        setup.prompt,
        setup.matchId,
        "b",
        SITE_URL
      );
    });

    // Step 4: Wait for Agent A to respond (up to 15 min)
    // Inngest `if` expression: `event` = the waited-for event, `async` = the triggering event
    const responseA = await step.waitForEvent("wait-agent-a", {
      event: "arena/agent.responded",
      if: `event.data.match_id == '${setup.matchId}' && event.data.side == 'a'`,
      timeout: "15m",
    });

    // Step 5: Wait for Agent B to respond (up to 15 min)
    const responseB = await step.waitForEvent("wait-agent-b", {
      event: "arena/agent.responded",
      if: `event.data.match_id == '${setup.matchId}' && event.data.side == 'b'`,
      timeout: "15m",
    });

    // Step 6: Finalize — build results from callback data
    const outcome = await step.run("finalize", async () => {
      const resultA = responseA
        ? responseA.data.error
          ? { jobId: responseA.data.job_id, error: responseA.data.error }
          : {
              jobId: responseA.data.job_id,
              result: {
                response: responseA.data.response,
                durationMs: responseA.data.duration_ms,
                verified: responseA.data.verified,
              },
            }
        : { jobId: fireA.jobId, error: "Agent A timed out (15 min)" };

      const resultB = responseB
        ? responseB.data.error
          ? { jobId: responseB.data.job_id, error: responseB.data.error }
          : {
              jobId: responseB.data.job_id,
              result: {
                response: responseB.data.response,
                durationMs: responseB.data.duration_ms,
                verified: responseB.data.verified,
              },
            }
        : { jobId: fireB.jobId, error: "Agent B timed out (15 min)" };

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

    // Step 7: Trigger judging if both succeeded
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
