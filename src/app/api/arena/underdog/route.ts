import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

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
      sentiment: { type: "string", enum: ["positive", "negative", "neutral", "mixed"] },
      scores: {
        type: "object",
        properties: {
          positive: { type: "number" },
          negative: { type: "number" },
          neutral: { type: "number" },
        },
      },
      sentences: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            sentiment: { type: "string" },
            score: { type: "number" },
          },
        },
      },
    },
  };

  const userPrompt = `You are handling the "${capability}" capability.

INPUT:
${JSON.stringify(input, null, 2)}

OUTPUT SCHEMA (your response MUST match this JSON structure):
${JSON.stringify(outputSchema, null, 2)}

Respond with ONLY valid JSON matching the output schema. No markdown, no explanation, no code blocks. Just the JSON object.

Apply your full market analytics expertise to this data. Don't give a surface-level analysis — dig into the dynamics.`;

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
    return NextResponse.json({ error: "Failed to parse response as JSON" }, { status: 500 });
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
