import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

/**
 * Universal endpoint for config-driven agents.
 *
 * Loads system_prompt + model_id from the agents table and executes
 * any Architect-generated (or manually configured) agent. No code
 * duplication — one route serves all custom agents.
 */

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1.0 / 1_000_000, output: 5.0 / 1_000_000 },
  "claude-sonnet-4-5-20250514": { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  "claude-opus-4-6-20250619": { input: 15.0 / 1_000_000, output: 75.0 / 1_000_000 },
};

interface CapabilityDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // 1. Load agent config from DB
  const admin = createAdminClient();
  const { data: agent, error } = await admin
    .from("agents")
    .select("id, name, slug, system_prompt, model_id, capability_schema, status")
    .eq("slug", slug)
    .eq("status", "active")
    .single();

  if (error || !agent) {
    return NextResponse.json(
      { error: `Agent '${slug}' not found or inactive` },
      { status: 404 }
    );
  }

  if (!agent.system_prompt) {
    return NextResponse.json(
      { error: `Agent '${slug}' has no system prompt configured` },
      { status: 400 }
    );
  }

  // 2. Parse A2A JSON-RPC request
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rpcParams = body.params as Record<string, unknown> | undefined;
  const rpcMessage = rpcParams?.message as Record<string, unknown> | undefined;
  const parts = rpcMessage?.parts as Array<Record<string, unknown>> | undefined;
  const metadata = rpcParams?.metadata as Record<string, unknown> | undefined;

  const input = (parts?.[0]?.data ?? rpcParams?.input ?? body.input ?? {}) as Record<string, unknown>;
  const capability = (metadata?.capability_used ?? rpcParams?.capability ?? body.capability ?? "analyze") as string;

  // 3. Find the output schema for this capability
  const capabilities = (agent.capability_schema as CapabilityDef[]) ?? [];
  const capDef = capabilities.find((c) => c.name === capability);
  const outputSchema = capDef?.outputSchema ?? null;

  // 4. Build the user prompt
  const modelId = (agent.model_id as string) ?? "claude-haiku-4-5-20251001";

  const userPrompt = `You are handling the "${capability}" capability.

INPUT:
${JSON.stringify(input, null, 2)}

${outputSchema ? `OUTPUT SCHEMA (your response MUST match this JSON structure):
${JSON.stringify(outputSchema, null, 2)}

Respond with ONLY valid JSON matching the output schema. No markdown, no explanation, no code blocks. Just the JSON object.` : `Respond with ONLY valid JSON. No markdown, no explanation, no code blocks.`}`;

  // 5. Call Claude with the agent's system prompt
  const message = await anthropic.messages.create({
    model: modelId,
    max_tokens: 4096,
    system: agent.system_prompt as string,
    messages: [{ role: "user", content: userPrompt }],
  });

  const pricing = MODEL_PRICING[modelId] ?? MODEL_PRICING["claude-haiku-4-5-20251001"];
  const apiCost =
    message.usage.input_tokens * pricing.input +
    message.usage.output_tokens * pricing.output;

  const content = message.content[0];
  if (content.type !== "text") {
    return NextResponse.json({ error: "Unexpected response type" }, { status: 500 });
  }

  // 6. Parse JSON response (with truncation repair from Underdog pattern)
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
      return NextResponse.json({ error: "Failed to parse agent response as JSON" }, { status: 500 });
    }
  }

  // 7. Return A2A JSON-RPC response
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
          model: modelId,
        },
      },
    },
  });
}
