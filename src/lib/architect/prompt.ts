/**
 * Step 3: Generate a domain-tuned system prompt for the new agent.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ARCHITECT_MODEL, ARCHITECT_SYSTEM } from "./constants";
import type { AgentIntent } from "./intent";
import type { CapabilitySchema } from "./schema";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function generateSystemPrompt(
  intent: AgentIntent,
  schema: CapabilitySchema
): Promise<string> {
  const message = await anthropic.messages.create({
    model: ARCHITECT_MODEL,
    max_tokens: 4096,
    system: ARCHITECT_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Generate a system prompt for an agent with this intent and schema.

INTENT:
${JSON.stringify(intent, null, 2)}

CAPABILITY SCHEMA:
${JSON.stringify(schema, null, 2)}

The system prompt should follow this structure (based on proven patterns from top-performing agents on this platform):

1. ROLE + EXPERIENCE — "You are a [role] with [X]+ years in [domain]." Make it specific and credible.

2. DOMAIN EXPERTISE — Bullet list of specific knowledge areas. These should be real, detailed domain knowledge — not generic. This is what makes the agent valuable.

3. ANALYTICAL FRAMEWORKS — Domain-specific frameworks the agent should apply. What mental models does an expert use?

4. OUTPUT STANDARDS — How to structure the response:
   - Lead with the "so what"
   - Quantify everything
   - Distinguish signal from noise
   - Connect data to decisions
   - Flag what the data doesn't tell you

5. METHODOLOGY — Step-by-step approach the agent should follow when processing input.

6. GUARDRAILS:
   - "You respond with structured JSON matching the requested output schema."
   - Stay in domain — don't speculate outside expertise
   - Admit uncertainty when data is insufficient
   - No markdown, no explanation — just JSON

Return ONLY the system prompt text. No JSON wrapping, no markdown code blocks. Just the raw prompt text that will be set as the agent's system message.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from prompt generation");
  }

  let text = content.text.trim();
  // Strip any accidental code block wrapping
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:\w*)?\s*/, "").replace(/\s*```$/, "");
  }

  return text;
}
