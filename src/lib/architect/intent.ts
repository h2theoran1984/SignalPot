/**
 * Step 1: Parse a natural language description into structured intent.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ARCHITECT_MODEL, ARCHITECT_SYSTEM } from "./constants";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface AgentIntent {
  domain: string;
  capability_type: string;
  capability_name: string;
  agent_name: string;
  inputs_needed: string[];
  outputs_expected: string[];
  complexity: "low" | "medium" | "high";
  suggested_model: "haiku" | "sonnet" | "opus";
  domain_expertise: string[];
  description_summary: string;
}

export async function parseIntent(description: string): Promise<AgentIntent> {
  const message = await anthropic.messages.create({
    model: ARCHITECT_MODEL,
    max_tokens: 2048,
    system: ARCHITECT_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Parse the following agent description into structured intent.

DESCRIPTION:
${description}

Respond with ONLY valid JSON matching this structure:
{
  "domain": "e.g. CPG / OTC pharmaceuticals",
  "capability_type": "e.g. price_monitoring, market_analysis, trend_detection",
  "capability_name": "snake_case name for the capability, e.g. price_watch",
  "agent_name": "Human-readable name, e.g. Price Watch Agent",
  "inputs_needed": ["list of input fields the agent needs"],
  "outputs_expected": ["list of output fields the agent should produce"],
  "complexity": "low|medium|high",
  "suggested_model": "haiku for most tasks, sonnet for complex reasoning, opus only for very complex",
  "domain_expertise": ["list of specific domain knowledge areas the agent should have"],
  "description_summary": "One-sentence summary of what this agent does"
}

No markdown, no explanation. Just the JSON.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from intent parsing");
  }

  let text = content.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  return JSON.parse(text) as AgentIntent;
}
