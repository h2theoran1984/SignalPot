// Arena Judge — calls The Arbiter to judge undercard matches.
// Uses domain-specific rubrics for structured scoring.
// Reuses the MCP call + Claude fallback pattern from src/lib/dispute/arbiter.ts.

import { createAdminClient } from "@/lib/supabase/admin";
import { wrapRequest, wrapResponse } from "@/lib/envelope";
import { validateOutput } from "@/lib/schema-validator";
import Anthropic from "@anthropic-ai/sdk";
import type { Agent } from "@/lib/types";
import type { ArenaJudgment, ArenaRubric } from "./types";
import { inferRubric, buildJudgePrompt, assembleBreakdown } from "./rubric";
import { LEVEL_CONFIGS, type ArenaLevel } from "./levels";

const ARBITER_SLUG = "the-arbiter";
const ARBITER_CAPABILITY = "signalpot/arbitrate@v1";
const ARBITER_TIMEOUT_MS = 30_000;

const anthropic = new Anthropic();

interface ArenaJudgeInput {
  matchId: string;
  capability: string;
  promptText: string | null;
  prompt: Record<string, unknown>;
  agentAName: string;
  agentBName: string;
  responseA: Record<string, unknown>;
  responseB: Record<string, unknown>;
  durationAMs: number;
  durationBMs: number;
  verifiedA: boolean;
  verifiedB: boolean;
  rubric?: ArenaRubric;
  costACents: number;
  costBCents: number;
  level?: ArenaLevel;
}

/**
 * Call The Arbiter to judge an undercard arena match.
 * 1. Looks up The Arbiter agent from the DB
 * 2. Creates a job record (feeds trust graph)
 * 3. Calls MCP endpoint with both agent responses + rubric
 * 4. Falls back to Claude Haiku if MCP fails
 * 5. Computes speed/cost scores server-side, assembles breakdown
 * Returns: { winner, reasoning, confidence, source, breakdown? }
 */
export async function callArenaJudge(
  input: ArenaJudgeInput
): Promise<ArenaJudgment> {
  const admin = createAdminClient();
  const rubric = input.rubric ?? inferRubric(input.capability);

  // Look up The Arbiter agent
  const { data: arbiter } = await admin
    .from("agents")
    .select("id, slug, mcp_endpoint, capability_schema, status")
    .eq("slug", ARBITER_SLUG)
    .eq("status", "active")
    .single();

  if (!arbiter || !arbiter.mcp_endpoint) {
    console.warn("[arena-judge] The Arbiter not found or no endpoint — using fallback");
    return callJudgeFallback(input, rubric);
  }

  // Create a job record for this judgment
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      provider_agent_id: arbiter.id,
      requester_profile_id: null,
      requester_agent_id: null,
      job_type: "production",
      capability_used: ARBITER_CAPABILITY,
      input_summary: {
        match_id: input.matchId,
        capability: input.capability,
        rubric_domain: rubric.domain,
        context: "arena_judgment",
      },
      status: "pending",
      cost: 0,
      verified: false,
    })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("[arena-judge] Failed to create job record");
    return callJudgeFallback(input, rubric);
  }

  const jobId = job.id as string;

  // Build request envelope
  const judgeInput = {
    context: "arena_match_judgment",
    match_id: input.matchId,
    capability: input.capability,
    level: input.level ?? 1,
    prompt: input.prompt,
    prompt_text: input.promptText,
    rubric,
    agent_a: {
      name: input.agentAName,
      response: input.responseA,
      duration_ms: input.durationAMs,
      schema_verified: input.verifiedA,
      cost_cents: input.costACents,
    },
    agent_b: {
      name: input.agentBName,
      response: input.responseB,
      duration_ms: input.durationBMs,
      schema_verified: input.verifiedB,
      cost_cents: input.costBCents,
    },
  };

  const requestEnvelope = wrapRequest({
    jobId,
    callerId: `arena:${input.matchId}`,
    providerSlug: ARBITER_SLUG,
    capability: ARBITER_CAPABILITY,
    input: judgeInput,
  });

  // Update job to running
  await admin
    .from("jobs")
    .update({
      input_summary: { ...judgeInput, _envelope: requestEnvelope },
      status: "running",
    })
    .eq("id", jobId);

  // Call The Arbiter's MCP endpoint
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ARBITER_TIMEOUT_MS);

    const res = await fetch(arbiter.mcp_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capability: ARBITER_CAPABILITY,
        input: judgeInput,
        job_id: jobId,
        _envelope: requestEnvelope,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Arbiter returned ${res.status}`);
    }

    const agentResponse = (await res.json()) as Record<string, unknown>;
    const durationMs = Date.now() - startTime;

    // Validate output against The Arbiter's declared schema
    const capSchemas = (arbiter.capability_schema as unknown as Array<Record<string, unknown>>) ?? [];
    const matchedCap = capSchemas.find(
      (c) => (c as { name: string }).name === ARBITER_CAPABILITY
    );
    const outputSchema = (matchedCap?.outputSchema as Record<string, unknown>) ?? null;
    const validation = validateOutput(outputSchema, agentResponse);

    // Build response envelope and update job
    const responseEnvelope = wrapResponse({
      jobId,
      providerSlug: ARBITER_SLUG,
      durationMs,
      output: agentResponse,
      verified: validation.valid,
      validationErrors: validation.errors,
    });

    await admin
      .from("jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        output_summary: { ...agentResponse, _envelope: responseEnvelope },
        duration_ms: durationMs,
        verified: validation.valid,
      })
      .eq("id", jobId);

    // Parse the judgment response
    const winner = agentResponse.winner as string;
    const reasoning = agentResponse.reasoning as string;
    const confidence = agentResponse.confidence as number;

    if (
      (winner === "a" || winner === "b" || winner === "tie") &&
      typeof confidence === "number" &&
      typeof reasoning === "string"
    ) {
      // Try to parse structured breakdown
      const breakdown = tryParseBreakdown(agentResponse, rubric, input);
      return { winner, reasoning, confidence, source: "arbiter", breakdown };
    }

    // Valid response but unexpected format — fall back
    console.warn("[arena-judge] Unexpected response format — using fallback");
    await admin.from("jobs").update({ verified: false }).eq("id", jobId);
    return callJudgeFallback(input, rubric);
  } catch (err) {
    const durationMs = Date.now() - startTime;

    await admin
      .from("jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
      })
      .eq("id", jobId);

    console.warn("[arena-judge] MCP call failed — using fallback");
    return callJudgeFallback(input, rubric);
  }
}

/**
 * Try to parse a structured breakdown from the Arbiter's response.
 * If the breakdown field is missing or malformed, returns undefined.
 */
function tryParseBreakdown(
  response: Record<string, unknown>,
  rubric: ArenaRubric,
  input: ArenaJudgeInput
) {
  try {
    const raw = response.breakdown as Record<string, unknown> | undefined;
    if (!raw) return undefined;

    const a = raw.a as { criteria_scores: Array<{ name: string; score: number }>; schema_compliance: number } | undefined;
    const b = raw.b as { criteria_scores: Array<{ name: string; score: number }>; schema_compliance: number } | undefined;

    if (!a?.criteria_scores || !b?.criteria_scores) return undefined;

    return assembleBreakdown({
      rubric,
      aiBreakdown: {
        a: { criteria_scores: a.criteria_scores, schema_compliance: a.schema_compliance ?? (input.verifiedA ? 1.0 : 0.0) },
        b: { criteria_scores: b.criteria_scores, schema_compliance: b.schema_compliance ?? (input.verifiedB ? 1.0 : 0.0) },
      },
      durationAMs: input.durationAMs,
      durationBMs: input.durationBMs,
      costACents: input.costACents,
      costBCents: input.costBCents,
    });
  } catch {
    return undefined;
  }
}

/**
 * Claude Haiku fallback — uses domain-specific rubric prompt.
 * Falls back to winner/reasoning/confidence if breakdown parsing fails.
 */
/** Get the fallback judge model — Sonnet for all levels (reliable rubric adherence). */
function getFallbackModel(level: ArenaLevel = 1): string {
  return "claude-sonnet-4-20250514";
}

/** Level-specific judge context injected into the prompt. */
function getLevelJudgeContext(level: ArenaLevel = 1): string {
  if (level === 2) {
    return "\n\nJUDGING CONTEXT: This is a Level 2 match. Apply stricter quality standards. Minor errors should be penalized more than at Level 1. Expect chain-of-thought reasoning and self-consistent outputs.";
  }
  if (level === 3) {
    return "\n\nJUDGING CONTEXT: This is a Level 3 (championship) match. Apply the strictest quality standards. Expect near-flawless, production-quality output. Even small mistakes, hallucinations, or missed edge cases should be heavily penalized. Only truly exceptional responses deserve high scores.";
  }
  if (level === 4) {
    return "\n\nJUDGING CONTEXT: This is a Level 4 (FINAL BOSS) match. Apply ABSOLUTE PERFECTION standards. Zero mercy. A single hallucination, missed edge case, schema violation, or factual error should devastate the score. Both agents should be held to the standard of the best possible output a human expert could produce. Scores above 0.9 should be reserved for genuinely flawless work. Be ruthless.";
  }
  return "";
}

async function callJudgeFallback(
  input: ArenaJudgeInput,
  rubric: ArenaRubric
): Promise<ArenaJudgment> {
  const level = input.level ?? 1;
  const prompt = buildJudgePrompt(rubric, {
    capability: input.capability,
    promptText: input.promptText,
    prompt: input.prompt,
    agentAName: input.agentAName,
    agentBName: input.agentBName,
    responseA: input.responseA,
    responseB: input.responseB,
    durationAMs: input.durationAMs,
    durationBMs: input.durationBMs,
    verifiedA: input.verifiedA,
    verifiedB: input.verifiedB,
  }) + getLevelJudgeContext(level);

  try {
    const message = await anthropic.messages.create({
      model: getFallbackModel(level),
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]) as {
      winner: "a" | "b" | "tie";
      reasoning: string;
      confidence: number;
      breakdown?: Record<string, unknown>;
    };

    // Try to assemble breakdown from parsed response
    const breakdown = tryParseBreakdown(
      parsed as unknown as Record<string, unknown>,
      rubric,
      input
    );

    return {
      winner: parsed.winner,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      source: "fallback",
      breakdown,
    };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error("[arena-judge] Fallback Claude call failed:", message);
    return {
      winner: "tie",
      reasoning: `AI judge could not render a verdict — defaulting to tie. (${message})`,
      confidence: 0.5,
      source: "fallback",
    };
  }
}
