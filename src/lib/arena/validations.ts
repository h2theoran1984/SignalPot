import { z } from "zod";

export const createMatchSchema = z
  .object({
    agent_a_slug: z.string().min(3).max(64),
    agent_b_slug: z.string().min(3).max(64),
    capability: z.string().min(1).max(200),
    prompt: z.record(z.string(), z.unknown()).refine(
      (val) => JSON.stringify(val).length <= 10_240,
      { message: "Prompt payload must be 10KB or less" }
    ),
    prompt_text: z.string().max(500).optional(),
    challenge_id: z.string().uuid().optional(),
  })
  .refine((data) => data.agent_a_slug !== data.agent_b_slug, {
    message: "Agents must be different",
  });

export const voteSchema = z.object({
  vote: z.enum(["a", "b", "tie"]),
});
