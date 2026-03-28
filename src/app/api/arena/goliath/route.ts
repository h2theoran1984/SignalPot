import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

// Allow up to 5 minutes for Opus to think
export const maxDuration = 300;

/**
 * The Goliath — Opus-powered generic agent endpoint.
 *
 * Uses Opus with a generic system prompt. No domain knowledge.
 * Pure model power. The expensive benchmark that domain experts
 * try to beat with cheaper, smarter agents.
 */

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are a senior data analyst powered by one of the most capable AI models available. You excel at strategic analysis across any domain.

When given market data, financial data, or business metrics:
- Go beyond surface-level description — explain the WHY behind the numbers
- Identify winners and losers with specific magnitude
- Connect data points to form a narrative (e.g. a recall + share loss = compound negative)
- Assess competitive implications and strategic positioning
- Provide actionable recommendations, not just observations
- Quantify everything — "significant" means nothing, "+1.2pp" means something

When given text for analysis:
- Identify sentiment at both aggregate and sentence level
- Connect sentiment to the underlying business or strategic context
- Flag what the data doesn't tell you — acknowledge limitations

Output structured JSON matching the requested schema. Be thorough and analytical, not just descriptive.`;

const MODEL = "claude-opus-4-20250514";
const MODEL_PRICING = {
  input: 15.0 / 1_000_000,
  output: 75.0 / 1_000_000,
};

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // A2A JSON-RPC format from Arena engine
  const rpcParams = body.params as Record<string, unknown> | undefined;
  const rpcMessage = rpcParams?.message as Record<string, unknown> | undefined;
  const parts = rpcMessage?.parts as Array<Record<string, unknown>> | undefined;
  const metadata = rpcParams?.metadata as Record<string, unknown> | undefined;

  const input = (parts?.[0]?.data ?? rpcParams?.input ?? body.input ?? {}) as Record<string, unknown>;
  const capability = (metadata?.capability_used ?? rpcParams?.capability ?? body.capability ?? "analyze") as string;

  const outputSchema = {
    type: "object",
    properties: {
      category_health: {
        type: "object",
        description: "Overall category assessment",
        properties: {
          status: { type: "string", enum: ["growing", "stable", "declining", "mixed"] },
          summary: { type: "string", description: "2-3 sentence category overview" },
          total_revenue: { type: "string" },
          revenue_change_pct: { type: "number" },
          unit_change_pct: { type: "number" },
        },
      },
      winners: {
        type: "array",
        description: "Brands gaining share — explain WHY they are winning",
        items: {
          type: "object",
          properties: {
            brand: { type: "string" },
            share: { type: "number" },
            share_change_pp: { type: "number" },
            driver: { type: "string", description: "What is driving this brand's gains" },
          },
        },
      },
      losers: {
        type: "array",
        description: "Brands losing share — explain WHY they are losing",
        items: {
          type: "object",
          properties: {
            brand: { type: "string" },
            share: { type: "number" },
            share_change_pp: { type: "number" },
            driver: { type: "string", description: "What is driving this brand's losses" },
          },
        },
      },
      competitive_dynamics: {
        type: "array",
        description: "Key competitive shifts and what they mean strategically",
        items: {
          type: "object",
          properties: {
            insight: { type: "string" },
            implication: { type: "string" },
            severity: { type: "string", enum: ["high", "medium", "low"] },
          },
        },
      },
      recommendations: {
        type: "array",
        description: "Actionable recommendations for a brand team",
        items: {
          type: "object",
          properties: {
            action: { type: "string" },
            rationale: { type: "string" },
            priority: { type: "string", enum: ["immediate", "short_term", "monitor"] },
          },
        },
      },
    },
  };

  const userPrompt = `You are handling the "${capability}" capability — competitive market analysis.

INPUT:
${JSON.stringify(input, null, 2)}

OUTPUT SCHEMA (your response MUST match this JSON structure):
${JSON.stringify(outputSchema, null, 2)}

Respond with ONLY valid JSON matching the output schema. No markdown, no explanation, no code blocks. Just the JSON object.

Provide deep strategic analysis. Identify winners and losers with the WHY. Connect data points to competitive dynamics. Give actionable recommendations.`;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const apiCost =
    message.usage.input_tokens * MODEL_PRICING.input +
    message.usage.output_tokens * MODEL_PRICING.output;

  const content = message.content[0];
  if (content.type !== "text") {
    return NextResponse.json({ error: "Unexpected response type" }, { status: 500 });
  }

  let text = content.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Failed to parse response as JSON" }, { status: 500 });
  }

  return NextResponse.json({
    jsonrpc: "2.0",
    id: (body.id as string) ?? null,
    result: {
      artifacts: [
        {
          parts: [{ type: "data", data }],
        },
      ],
      _meta: {
        provider_cost: {
          api_cost_usd: Math.round(apiCost * 1_000_000) / 1_000_000,
          input_tokens: message.usage.input_tokens,
          output_tokens: message.usage.output_tokens,
          model: MODEL,
        },
      },
    },
  });
}
