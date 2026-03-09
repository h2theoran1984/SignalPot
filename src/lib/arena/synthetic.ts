/**
 * Synthetic prompt generator for arena matches.
 * Uses Claude Haiku to generate capability-aware test prompts dynamically.
 * Falls back to static pools if the API call fails.
 */

import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Static fallback pools (used when Claude API is unavailable)
// ---------------------------------------------------------------------------

const FALLBACK_PROMPTS: Record<string, () => { prompt: Record<string, unknown>; description: string }> = {
  "meeting-summary": () => ({
    prompt: { text: MEETING_TRANSCRIPT },
    description: "Summarize a meeting transcript",
  }),
  "action-items": () => ({
    prompt: { text: MEETING_TRANSCRIPT },
    description: "Extract action items from a meeting",
  }),
  "sentiment": () => ({
    prompt: { text: "The migration project has been nothing but delays and cost overruns. Three key engineers quit in the last month, the vendor keeps missing deadlines, and stakeholders are losing patience. We need a completely new approach or this project is going to be cancelled." },
    description: "Analyze text sentiment",
  }),
  "text-summary": () => ({
    prompt: { text: "Retrieval-Augmented Generation (RAG) has become the dominant pattern for building LLM-powered applications that need access to current or proprietary data. Rather than fine-tuning a model on specific data, RAG retrieves relevant documents at query time and includes them in the context window." },
    description: "Summarize a text passage",
  }),
  "github-summary": () => ({
    prompt: { repo_url: "https://github.com/anthropics/anthropic-sdk-python" },
    description: "Summarize anthropics/anthropic-sdk-python",
  }),
  "run": () => ({
    prompt: { language: "python", code: "def fibonacci(n):\n    if n <= 1:\n        return n\n    a, b = 0, 1\n    for _ in range(2, n + 1):\n        a, b = b, a + b\n    return b\n\nprint([fibonacci(i) for i in range(15)])" },
    description: "Execute a code snippet",
  }),
  "search": () => ({
    prompt: { query: "recent developments in autonomous AI agents 2026", max_results: 5 },
    description: "Search for AI agent developments",
  }),
};

const MEETING_TRANSCRIPT = `Meeting: Q3 Sprint Planning — March 9, 2026
Attendees: Sarah (PM), Jake (Engineering), Lisa (Design), Tom (QA)

Sarah: Let's get started. We need to finalize the v2.1 release scope by Friday. Jake, where are we on the API migration?

Jake: The REST-to-GraphQL migration is about 70% done. I need Lisa's updated component specs before I can wire up the new dashboard endpoints. Realistically I need those by Wednesday.

Lisa: I can have the dashboard specs ready by Tuesday EOD. But I'm blocked on the brand guidelines update from marketing — Tom, did they send those over?

Tom: Not yet. I'll ping Maria today and escalate if we don't hear back by tomorrow noon. Also, I found three critical bugs in the payment flow during last week's regression. We need to decide if those are release blockers.

Sarah: Yes, payment bugs are blockers. Jake, can you triage those today and give estimates?

Jake: Will do. I'll have severity assessments by end of day.

Sarah: Great. Let's reconvene Wednesday at 2pm for a checkpoint.`;

// ---------------------------------------------------------------------------
// Dynamic generation via Claude Haiku
// ---------------------------------------------------------------------------

let _anthropic: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

/**
 * Normalize capability name: "signalpot/meeting-summary@v1" → "meeting-summary"
 */
function normalizeCapability(capability: string): string {
  let verb = capability;
  if (verb.includes("/")) {
    verb = verb.split("/").pop()?.split("@")[0] ?? verb;
  }
  return verb;
}

/**
 * Build a system prompt that tells Claude what kind of test data to generate.
 */
function buildSystemPrompt(capability: string, inputSchema?: Record<string, unknown>): string {
  const schemaHint = inputSchema
    ? `\n\nThe agent's input schema is:\n${JSON.stringify(inputSchema, null, 2)}\n\nYour JSON output MUST conform to this schema exactly.`
    : "";

  return `You are a test data generator for an AI agent arena. Your job is to create realistic, varied test inputs for agents being evaluated.

The capability being tested is: "${capability}"

Generate a single realistic test input as a JSON object. The input should be:
- Realistic and detailed enough to properly test the agent
- Different each time (vary topics, scenarios, names, numbers)
- Appropriately sized (meeting transcripts: 200-400 words, text passages: 100-200 words, etc.)
- Professional and work-appropriate
${schemaHint}

IMPORTANT: Return a JSON object with exactly two keys:
- "prompt": the test input data (the actual payload the agent will receive)
- "description": a 5-8 word human-readable label for this test scenario

Example format: {"prompt": {...}, "description": "Analyze quarterly sales report sentiment"}

Return ONLY the JSON object. No markdown, no code fences, no explanation.`;
}

/**
 * Generate a synthetic prompt using Claude Haiku.
 * Returns null if generation fails (caller should use fallback).
 */
async function generateWithClaude(
  capability: string,
  inputSchema?: Record<string, unknown>
): Promise<{ prompt: Record<string, unknown>; description: string } | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-20250414",
      max_tokens: 1024,
      system: buildSystemPrompt(capability, inputSchema),
      messages: [
        {
          role: "user",
          content: `Generate a test input for the "${capability}" capability.`,
        },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : null;
    if (!text) return null;

    // Strip markdown code fences if Claude adds them despite instructions
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as { prompt: Record<string, unknown>; description: string };

    if (!parsed.prompt || typeof parsed.prompt !== "object") return null;

    return {
      prompt: parsed.prompt,
      description: typeof parsed.description === "string" ? parsed.description : `Test ${capability}`,
    };
  } catch (err) {
    console.warn("[synthetic] Claude generation failed, using fallback:", (err as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a synthetic prompt — tries Claude Haiku first, falls back to static data.
 *
 * @param capability  The capability name (e.g. "signalpot/meeting-summary@v1")
 * @param inputSchema Optional: the agent's declared input schema for this capability
 */
export async function generateSyntheticPrompt(
  capability: string,
  inputSchema?: Record<string, unknown>
): Promise<{ prompt: Record<string, unknown>; description: string }> {
  const verb = normalizeCapability(capability);

  // Try dynamic generation with Claude
  const dynamic = await generateWithClaude(verb, inputSchema);
  if (dynamic) return dynamic;

  // Fallback to static pools
  const fallback = FALLBACK_PROMPTS[verb];
  if (fallback) return fallback();

  // Ultimate fallback — generic text prompt
  return {
    prompt: { text: MEETING_TRANSCRIPT },
    description: "Process a meeting transcript",
  };
}

/**
 * Synchronous fallback — used only when you can't await.
 * Always returns static data.
 */
export function generateSyntheticPromptSync(capability: string): {
  prompt: Record<string, unknown>;
  description: string;
} {
  const verb = normalizeCapability(capability);
  const fallback = FALLBACK_PROMPTS[verb];
  if (fallback) return fallback();

  return {
    prompt: { text: MEETING_TRANSCRIPT },
    description: "Process a meeting transcript",
  };
}
