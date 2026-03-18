// POST /api/tools/prompt-advisor — Free, public prompt analysis tool.
// Takes a system prompt + capability description, returns improvement suggestions.
// Rate-limited by IP. No auth required.

import { NextRequest, NextResponse } from "next/server";
import { checkPublicRateLimit } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const anthropic = new Anthropic();

const advisorSchema = z.object({
  system_prompt: z.string().min(10).max(10_000),
  capability: z.string().min(1).max(200),
  model_hint: z.string().max(50).optional(),
});

const advisorResponseSchema = z.object({
  score: z.number().min(1).max(10),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  suggestions: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      priority: z.enum(["high", "medium", "low"]),
    })
  ),
  improved_prompt: z.string(),
});

export async function POST(request: NextRequest) {
  // IP rate limit — no auth required
  const rateLimited = await checkPublicRateLimit(request);
  if (rateLimited) return rateLimited;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = advisorSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { system_prompt, capability, model_hint } = parsed.data;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: `You are an expert AI prompt engineer. Analyze system prompts and provide actionable improvement suggestions.

Your analysis should be practical and specific — not generic advice. Focus on:
1. Clarity of instructions
2. Output format specification
3. Edge case handling
4. Constraint completeness
5. Potential failure modes
6. Cost efficiency (unnecessary verbosity wastes tokens)

Respond with ONLY valid JSON matching this schema:
{
  "score": <number 1-10>,
  "strengths": [<string>, ...],
  "weaknesses": [<string>, ...],
  "suggestions": [{ "title": <string>, "description": <string>, "priority": "high" | "medium" | "low" }, ...],
  "improved_prompt": <string>
}

The improved_prompt should be a complete rewritten version incorporating your suggestions. Keep it concise but thorough.`,

      messages: [
        {
          role: "user",
          content: `## System Prompt to Analyze
${system_prompt}

## Capability / Use Case
${capability}
${model_hint ? `\n## Target Model\n${model_hint}` : ""}

Analyze this prompt and provide your assessment with an improved version.`,
        },
      ],
    });

    const content = message.content[0];
    if (content.type !== "text") {
      return NextResponse.json({ error: "Unexpected response" }, { status: 500 });
    }

    // Strip accidental markdown fences
    let text = content.text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      console.error("[prompt-advisor] Model returned invalid JSON");
      return NextResponse.json(
        { error: "Analysis produced invalid output — please try again" },
        { status: 502 }
      );
    }

    const validated = advisorResponseSchema.safeParse(raw);
    if (!validated.success) {
      console.error("[prompt-advisor] Response schema mismatch:", validated.error.flatten());
      return NextResponse.json(
        { error: "Analysis produced unexpected output — please try again" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      analysis: validated.data,
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
      },
    });
  } catch (err) {
    console.error("[prompt-advisor] Error:", err);
    return NextResponse.json(
      { error: "Analysis failed — please try again" },
      { status: 500 }
    );
  }
}
