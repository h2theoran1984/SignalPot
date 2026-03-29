/**
 * Step 2: Generate capability schemas (inputSchema + outputSchema) from intent.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ARCHITECT_MODEL, ARCHITECT_SYSTEM, CAPABILITY_EXAMPLES } from "./constants";
import { parseJsonResponse } from "./parse-json";
import type { AgentIntent } from "./intent";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface CapabilitySchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export async function generateSchema(intent: AgentIntent): Promise<CapabilitySchema> {
  const examplesText = CAPABILITY_EXAMPLES.map(
    (ex, i) =>
      `Example ${i + 1} — "${ex.description}":\n${JSON.stringify(ex.schema, null, 2)}`
  ).join("\n\n");

  const message = await anthropic.messages.create({
    model: ARCHITECT_MODEL,
    max_tokens: 4096,
    system: ARCHITECT_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Generate a capability schema for an agent with this intent:

INTENT:
${JSON.stringify(intent, null, 2)}

Here are examples of well-structured capability schemas on this platform:

${examplesText}

Generate a capability schema following the same patterns. The schema should:
- Have a snake_case "name" matching the capability_type
- Have a clear "description"
- Have an "inputSchema" with all fields the agent needs (JSON Schema format with type, properties, required, descriptions)
- Have an "outputSchema" with all fields the agent produces (JSON Schema format)
- Use arrays of objects for lists (not just arrays of strings)
- Include "description" on properties to guide the agent
- Keep it practical — include what's needed for the domain

Respond with ONLY the capability schema as JSON. No markdown, no wrapping.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from schema generation");
  }

  return parseJsonResponse(content.text) as CapabilitySchema;
}
