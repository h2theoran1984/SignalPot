import { z } from "zod";

/** Maximum prompt payload size in bytes (10 KB). */
const MAX_PROMPT_BYTES = 10_240;

export const createMatchSchema = z
  .object({
    agent_a_slug: z.string().min(3).max(64),
    agent_b_slug: z.string().min(3).max(64),
    capability: z.string().min(1).max(200),
    prompt: z.record(z.string(), z.unknown()).refine(
      (val) => JSON.stringify(val).length <= MAX_PROMPT_BYTES,
      { message: "Prompt payload must be 10KB or less" }
    ),
    prompt_text: z.string().max(500).optional(),
    challenge_id: z.string().uuid().optional(),
  })
  .refine((data) => data.agent_a_slug !== data.agent_b_slug, {
    message: "Agents must be different",
  });

/** Schema for /api/arena/fight — synchronous match endpoint. */
export const fightSchema = z
  .object({
    agent_a_slug: z.string().min(3).max(64),
    agent_b_slug: z.string().min(3).max(64),
    capability: z.string().min(1).max(200),
    prompt: z
      .record(z.string(), z.unknown())
      .refine((val) => JSON.stringify(val).length <= MAX_PROMPT_BYTES, {
        message: "Prompt payload must be 10KB or less",
      })
      .optional(),
    challenge_id: z.string().uuid().optional(),
    level: z.number().int().min(1).max(3).optional(),
  })
  .refine((data) => data.agent_a_slug !== data.agent_b_slug, {
    message: "Agents must be different",
  });

export const voteSchema = z.object({
  vote: z.enum(["a", "b", "tie"]),
});
