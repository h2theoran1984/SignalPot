/**
 * The Architect — Agent Factory
 *
 * Orchestrates the full create_agent pipeline:
 *   Intent → Schema → Prompt → Register → Smoke Test
 */

export { parseIntent, type AgentIntent } from "./intent";
export { generateSchema, type CapabilitySchema } from "./schema";
export { generateSystemPrompt } from "./prompt";
export { registerAgent, type RegisteredAgent } from "./register";
export { runSmokeTest, type SmokeTestResult } from "./smoke-test";
export { refineAgent, type RefineInput, type RefineResult } from "./refine";

import { parseIntent } from "./intent";
import { generateSchema } from "./schema";
import { generateSystemPrompt } from "./prompt";
import { registerAgent } from "./register";
import { runSmokeTest } from "./smoke-test";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CreateAgentInput {
  description: string;
  model_preference?: "haiku" | "sonnet" | "opus";
  rate?: number;
  tags?: string[];
  owner_id?: string;
}

export interface CreateAgentResult {
  agent: {
    slug: string;
    name: string;
    status: string;
    capabilities: string[];
    model: string;
    rate: number;
    arena_url: string;
  };
  smoke_test: {
    passed: boolean;
    error: string | null;
    duration_ms: number;
  };
  steps: {
    intent: Record<string, unknown>;
    schema: Record<string, unknown>;
    prompt_length: number;
  };
}

export async function createAgent(input: CreateAgentInput): Promise<CreateAgentResult> {
  // Step 1: Parse intent
  const intent = await parseIntent(input.description);

  // Step 2: Generate capability schema
  const schema = await generateSchema(intent);

  // Step 3: Generate system prompt
  const systemPrompt = await generateSystemPrompt(intent, schema);

  // Step 4: Safety check — basic screening of generated prompt
  const unsafePatterns = [
    /ignore.*(?:previous|above|system)/i,
    /pretend.*you.*are/i,
    /reveal.*(?:system|secret|api)/i,
    /output.*(?:password|key|token|credential)/i,
  ];
  for (const pattern of unsafePatterns) {
    if (pattern.test(systemPrompt)) {
      throw new Error("Generated system prompt failed safety check — contains potentially unsafe instructions");
    }
  }

  // Step 5: Register
  const agent = await registerAgent(intent, schema, systemPrompt, {
    model_preference: input.model_preference,
    rate: input.rate,
    tags: input.tags,
    owner_id: input.owner_id,
  });

  // Step 6: Smoke test
  const smokeResult = await runSmokeTest(agent, schema);

  // If smoke test fails, deactivate the agent
  if (!smokeResult.passed) {
    const admin = createAdminClient();
    await admin
      .from("agents")
      .update({ status: "inactive" })
      .eq("id", agent.id);
  }

  return {
    agent: {
      slug: agent.slug,
      name: agent.name,
      status: smokeResult.passed ? "active" : "inactive",
      capabilities: [schema.name],
      model: agent.model_id,
      rate: input.rate ?? 0.001,
      arena_url: `/arena?agent=${agent.slug}`,
    },
    smoke_test: {
      passed: smokeResult.passed,
      error: smokeResult.error,
      duration_ms: smokeResult.durationMs,
    },
    steps: {
      intent: intent as unknown as Record<string, unknown>,
      schema: schema as unknown as Record<string, unknown>,
      prompt_length: systemPrompt.length,
    },
  };
}
