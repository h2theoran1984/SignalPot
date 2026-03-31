import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

/**
 * Universal endpoint for config-driven agents.
 *
 * Loads system_prompt + model_id from the agents table and executes
 * any Architect-generated (or manually configured) agent. No code
 * duplication — one route serves all custom agents.
 *
 * Supports both Anthropic (claude-*) and Google (gemini-*) models.
 */

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const google = process.env.GOOGLE_AI_API_KEY
  ? new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY)
  : null;

function isGoogleModel(modelId: string): boolean {
  return modelId.startsWith("gemini-");
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1.0 / 1_000_000, output: 5.0 / 1_000_000 },
  "claude-sonnet-4-5-20250514": { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  "claude-opus-4-6-20250619": { input: 15.0 / 1_000_000, output: 75.0 / 1_000_000 },
  "gemini-2.0-flash": { input: 0.10 / 1_000_000, output: 0.40 / 1_000_000 },
  "gemini-2.5-flash-preview-05-20": { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
  "gemini-3-flash-preview": { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
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

  // 5. Call the model with the agent's system prompt
  let responseText: string;
  let inputTokens: number;
  let outputTokens: number;

  if (isGoogleModel(modelId)) {
    if (!google) {
      return NextResponse.json({ error: "Google AI not configured" }, { status: 500 });
    }

    const model = google.getGenerativeModel({
      model: modelId,
      systemInstruction: agent.system_prompt as string,
    });

    const response = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: 4096 },
    });

    responseText = response.response.text() ?? "";
    inputTokens = response.response.usageMetadata?.promptTokenCount ?? 0;
    outputTokens = response.response.usageMetadata?.candidatesTokenCount ?? 0;
  } else {
    const message = await anthropic.messages.create({
      model: modelId,
      max_tokens: 4096,
      system: agent.system_prompt as string,
      messages: [{ role: "user", content: userPrompt }],
    });

    const content = message.content[0];
    if (content.type !== "text") {
      return NextResponse.json({ error: "Unexpected response type" }, { status: 500 });
    }

    responseText = content.text;
    inputTokens = message.usage.input_tokens;
    outputTokens = message.usage.output_tokens;
  }

  const pricing = MODEL_PRICING[modelId] ?? MODEL_PRICING["claude-haiku-4-5-20251001"];
  const apiCost = inputTokens * pricing.input + outputTokens * pricing.output;

  // 6. Parse JSON response (with truncation repair from Underdog pattern)
  let text = responseText.trim();
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
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          model: modelId,
        },
      },
    },
  });
}
