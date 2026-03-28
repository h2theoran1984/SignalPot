import { inngest } from "@/lib/inngest/client";
import { setupMatch, callSingleAgent, fireAgentCall, finalizeMatch } from "@/lib/arena/engine";
import type { Agent } from "@/lib/types";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://signalpot.dev";

/**
 * Async match execution — hybrid sync/async pattern.
 *
 * Each agent call runs in its own Inngest step (5 min budget via maxDuration: 300).
 * For sync agents (current): step awaits the full call, then fires callback event.
 * For async agents (future): step fires request, then waitForEvent for callback.
 *
 * This eliminates the old 60s timeout. Each agent gets up to 5 minutes.
 * When agents support A2A async (202 Accepted + callback), the waitForEvent
 * path gives them up to 15 minutes.
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

    // Step 2: Call Agent A (sync — gets up to 5 min via maxDuration: 300)
    // Also fires the callback event so the flow is consistent with future async agents.
    const resultA = await step.run("call-agent-a", async () => {
      const result = await callSingleAgent(
        setup.agentA as Agent,
        setup.capability,
        setup.prompt,
        setup.matchId,
        "a"
      );

      // Fire callback event for consistency (finalizeMatch expects this format)
      await inngest.send({
        name: "arena/agent.responded",
        data: {
          match_id: setup.matchId,
          side: "a" as const,
          job_id: result.jobId,
          response: "result" in result ? result.result.response : {},
          duration_ms: "result" in result ? result.result.durationMs : 0,
          verified: "result" in result ? result.result.verified : false,
          provider_cost_usd: null,
          error: "error" in result ? result.error : null,
        },
      });

      return result;
    });

    // Step 3: Call Agent B (sync — gets up to 5 min via maxDuration: 300)
    const resultB = await step.run("call-agent-b", async () => {
      const result = await callSingleAgent(
        setup.agentB as Agent,
        setup.capability,
        setup.prompt,
        setup.matchId,
        "b"
      );

      await inngest.send({
        name: "arena/agent.responded",
        data: {
          match_id: setup.matchId,
          side: "b" as const,
          job_id: result.jobId,
          response: "result" in result ? result.result.response : {},
          duration_ms: "result" in result ? result.result.durationMs : 0,
          verified: "result" in result ? result.result.verified : false,
          provider_cost_usd: null,
          error: "error" in result ? result.error : null,
        },
      });

      return result;
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
