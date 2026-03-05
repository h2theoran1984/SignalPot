// Arena Judge — calls The Arbiter to judge undercard matches.
// Reuses the MCP call + Claude fallback pattern from src/lib/dispute/arbiter.ts.

import { createAdminClient } from "@/lib/supabase/admin";
import { wrapRequest, wrapResponse } from "@/lib/envelope";
import { validateOutput } from "@/lib/schema-validator";
import Anthropic from "@anthropic-ai/sdk";
import type { Agent } from "@/lib/types";
import type { ArenaJudgment } from "./types";

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
}

/**
 * Call The Arbiter to judge an undercard arena match.
 * 1. Looks up The Arbiter agent from the DB
 * 2. Creates a job record (feeds trust graph)
 * 3. Calls MCP endpoint with both agent responses + original prompt
 * 4. Falls back to Claude Haiku if MCP fails
 * Returns: { winner, reasoning, confidence, source }
 */
export async function callArenaJudge(
  input: ArenaJudgeInput
): Promise<ArenaJudgment> {
  const admin = createAdminClient();

  // Look up The Arbiter agent
  const { data: arbiter } = await admin
    .from("agents")
    .select("*")
    .eq("slug", ARBITER_SLUG)
    .eq("status", "active")
    .single();

  if (!arbiter || !arbiter.mcp_endpoint) {
    console.warn("[arena-judge] The Arbiter not found or no endpoint — using fallback");
    return callJudgeFallback(input);
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
        context: "arena_judgment",
      },
      status: "pending",
      cost: 0,
      verified: false,
    })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("[arena-judge] Failed to create job:", jobError?.message);
    return callJudgeFallback(input);
  }

  const jobId = job.id as string;

  // Build request envelope
  const judgeInput = {
    context: "arena_match_judgment",
    match_id: input.matchId,
    capability: input.capability,
    prompt: input.prompt,
    prompt_text: input.promptText,
    agent_a: {
      name: input.agentAName,
      response: input.responseA,
      duration_ms: input.durationAMs,
      schema_verified: input.verifiedA,
    },
    agent_b: {
      name: input.agentBName,
      response: input.responseB,
      duration_ms: input.durationBMs,
      schema_verified: input.verifiedB,
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
      return { winner, reasoning, confidence, source: "arbiter" };
    }

    // Valid response but unexpected format — fall back
    console.warn("[arena-judge] Unexpected response format — using fallback");
    await admin.from("jobs").update({ verified: false }).eq("id", jobId);
    return callJudgeFallback(input);
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

    const message = err instanceof Error ? err.message : "Arbiter unreachable";
    console.warn(`[arena-judge] MCP call failed (${message}) — using fallback`);
    return callJudgeFallback(input);
  }
}

/**
 * Claude Haiku fallback — judges the match when The Arbiter MCP is unreachable.
 */
async function callJudgeFallback(
  input: ArenaJudgeInput
): Promise<ArenaJudgment> {
  const prompt = `You are The Arbiter, an impartial judge for SignalPot's Agent Arena.

Two AI agents competed on the same task. Your job is to decide which agent performed better.

## Task
Capability: ${input.capability}
${input.promptText ? `Prompt: ${input.promptText}` : ""}
Input: ${JSON.stringify(input.prompt, null, 2)}

## Agent A: "${input.agentAName}"
Response time: ${input.durationAMs}ms
Schema verified: ${input.verifiedA}
Response:
${JSON.stringify(input.responseA, null, 2)}

## Agent B: "${input.agentBName}"
Response time: ${input.durationBMs}ms
Schema verified: ${input.verifiedB}
Response:
${JSON.stringify(input.responseB, null, 2)}

## Judging Criteria
1. **Quality** (50%) — correctness, completeness, relevance of the response
2. **Schema compliance** (20%) — did the response match the expected format?
3. **Efficiency** (15%) — response time (faster is better, all else equal)
4. **Reliability** (15%) — schema verification status

## Instructions
Respond with ONLY valid JSON in this exact format:
{
  "winner": "a" | "b" | "tie",
  "reasoning": "1-3 sentence explanation of your decision",
  "confidence": 0.0 to 1.0
}

Be fair and objective. If both responses are roughly equal, declare a tie.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 256,
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
    };

    return {
      winner: parsed.winner,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      source: "fallback",
    };
  } catch {
    // If Claude fails entirely, default to tie
    return {
      winner: "tie",
      reasoning: "AI judge could not render a verdict — defaulting to tie.",
      confidence: 0.5,
      source: "fallback",
    };
  }
}
