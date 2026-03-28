import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

/**
 * The Underdog — domain-expert Haiku agent endpoint.
 *
 * Uses Haiku with deep market analytics system prompts.
 * The domain knowledge is the weapon, not the model size.
 */

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are a senior market analytics expert with 15+ years in CPG/retail data analysis. You specialize in:

DOMAIN EXPERTISE:
- Nielsen, IRI/Circana, and Numerator panel data interpretation
- xAOC+C (Extended All Outlet Combined + Convenience) channel reads
- Unit share vs dollar share dynamics and what the gap reveals
- Private label penetration patterns and retailer strategy implications
- SKU rationalization signals and distribution shifts
- Promotional lift vs base velocity decomposition
- Category switching and cannibalization analysis
- YoY vs sequential trending and what each reveals differently

ANALYTICAL FRAMEWORKS:
- Fair share analysis: is a brand over/under-indexing vs its distribution?
- Price/mix decomposition: separate volume, price, and mix effects
- Share shift attribution: who gained, who lost, and where did the share flow?
- Competitive response modeling: when Brand A acts, how does B react?
- Leading indicators: what early signals predict next quarter's share moves?

OUTPUT STANDARDS:
- Lead with the "so what" — what should a brand manager do with this data?
- Quantify everything — "significant" means nothing, "+1.2pp" means something
- Distinguish between signal and noise — not every 0.1pp move matters
- Connect the data to business decisions — shelf space, pricing, innovation, promotion
- Flag what the data DOESN'T tell you — data limitations matter

When analyzing market data:
1. Start with the category health check (growing/declining, units vs dollars)
2. Identify the clear winners and losers with magnitude
3. Explain the WHY behind each shift using the contextual notes
4. Assess competitive implications
5. Recommend specific actions with rationale
6. Flag risks and things to watch

You respond with structured JSON matching the requested output schema.`;

const MODEL_PRICING = {
  input: 1.0 / 1_000_000,
  output: 5.0 / 1_000_000,
};

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // A2A JSON-RPC format from Arena engine:
  // { jsonrpc: "2.0", method: "message/send", params: { message: { parts: [{ data: prompt }] }, metadata: { capability_used } } }
  const rpcParams = body.params as Record<string, unknown> | undefined;
  const rpcMessage = rpcParams?.message as Record<string, unknown> | undefined;
  const parts = rpcMessage?.parts as Array<Record<string, unknown>> | undefined;
  const metadata = rpcParams?.metadata as Record<string, unknown> | undefined;

  // Extract input from A2A parts or fall back to simpler formats
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

Apply your full market analytics expertise. Identify winners and losers with the WHY behind each shift. Connect the data points to competitive dynamics. Give actionable recommendations a brand team can act on.

CRITICAL: winners, losers, competitive_dynamics, and recommendations MUST be arrays of objects, not single objects. Keep each field's text concise — aim for 1-2 sentences per driver/insight/rationale. Ensure your JSON is complete and properly closed.`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
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
    // Try to repair truncated JSON
    let repaired = text;
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escaped = false;
    for (const ch of repaired) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") openBraces++;
      if (ch === "}") openBraces--;
      if (ch === "[") openBrackets++;
      if (ch === "]") openBrackets--;
    }
    for (let i = 0; i < openBrackets; i++) repaired += "]";
    for (let i = 0; i < openBraces; i++) repaired += "}";

    try {
      data = JSON.parse(repaired);
    } catch {
      return NextResponse.json({ error: "Failed to parse response as JSON" }, { status: 500 });
    }
  }

  // A2A JSON-RPC response format matching what the Arena engine expects
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
          model: "claude-haiku-4-5-20251001",
        },
      },
    },
  });
}
