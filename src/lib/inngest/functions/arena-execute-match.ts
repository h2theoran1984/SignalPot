import { inngest } from "@/lib/inngest/client";
import { executeMatch } from "@/lib/arena/engine";

// Async match execution — triggered when a new arena match is created.
// Calls both agents in parallel and stores results.
export const arenaExecuteMatch = inngest.createFunction(
  {
    id: "arena-execute-match",
    name: "Arena — Execute Match",
    retries: 1, // only 1 retry — agent calls are expensive
  },
  { event: "arena/match.created" },
  async ({ event, step }) => {
    const { match_id } = event.data;

    const result = await step.run("execute-match", async () => {
      await executeMatch(match_id);
      return { match_id, status: "executed" };
    });

    return result;
  }
);
