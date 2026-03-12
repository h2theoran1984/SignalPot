/**
 * The house agent — universal arena contender.
 *
 * Handles ANY capability at 3 difficulty levels. Level 1 uses Haiku with
 * basic prompts, Level 2 uses Sonnet with chain-of-thought, Level 3 uses
 * Opus with multi-step reasoning. Lives inside the main app — no external
 * deployment needed.
 */
import Anthropic from "@anthropic-ai/sdk";
import { LEVEL_CONFIGS, type ArenaLevel } from "./levels";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Per-model pricing (per token)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001":  { input: 1.0 / 1_000_000, output: 5.0 / 1_000_000 },
  "claude-sonnet-4-20250514":   { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  "claude-opus-4-20250514":     { input: 15.0 / 1_000_000, output: 75.0 / 1_000_000 },
};

export interface CostInfo {
  api_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

// Capability-specific system prompts for higher quality
const SYSTEM_PROMPTS: Record<string, string> = {
  summarize:
    "You are an expert text summarizer. Produce concise, accurate summaries that capture the key information. Never fabricate facts not present in the source text.",
  analyze:
    "You are a sentiment analysis expert. Analyze text for emotional tone and provide accurate sentiment scores. Be nuanced — detect mixed sentiments when present.",
  search:
    "You are simulating a web search engine. Given a search query, generate realistic search results with plausible titles, URLs, and snippets. Make results relevant and varied.",
  run:
    "You are simulating a code execution sandbox. Given code in a programming language, determine what the output would be if executed. Provide accurate stdout, stderr, and exit code. Actually compute the results — do not guess.",
  translate:
    "You are an expert translator. Translate text accurately while preserving meaning, tone, and nuance. Identify the source language if not specified.",
  lookup:
    "You are simulating a DNS resolver. Given a domain and record type, generate realistic DNS records. Use plausible IP addresses, TTL values, and record data.",
  parse:
    "You are simulating a PDF parser. Given a PDF URL and parameters, generate realistic extracted content including text, page count, and metadata.",
  validate:
    "You are a JSON schema validator. Given data and a schema, determine if the data is valid and list any errors found.",
  convert:
    "You are a Markdown-to-HTML converter. Convert the given markdown to clean, semantic HTML.",
  scrape:
    "You are simulating a web scraper. Given a URL, generate realistic extracted content including title, text, links, and metadata.",
};

const DEFAULT_SYSTEM =
  "You are a versatile AI agent handling a capability request. Produce a high-quality response matching the required output format.";

// ── Level 2: Enhanced prompts (chain-of-thought + self-critique) ──────
const ENHANCED_SUFFIX =
  "\n\nThink step-by-step before responding. After generating your answer, self-critique: Is everything accurate? Did you miss anything? Revise if needed before finalizing.";

const ENHANCED_DEFAULT_SYSTEM =
  DEFAULT_SYSTEM + ENHANCED_SUFFIX;

// ── Level 3: Master prompts (multi-step reasoning, edge cases, perfectionism) ──
const MASTER_SUFFIX =
  "\n\nFollow a rigorous multi-step process:\n1. ANALYZE the input thoroughly — identify structure, intent, and edge cases.\n2. PLAN your response — consider multiple approaches, pick the best one.\n3. EXECUTE with precision — every detail matters.\n4. VERIFY — check for errors, hallucinations, missed nuances. Fix anything wrong.\n5. POLISH — ensure the output is production-quality and complete.\n\nYour response should be indistinguishable from expert human work.";

const MASTER_DEFAULT_SYSTEM =
  DEFAULT_SYSTEM + MASTER_SUFFIX;

// ── Level 4: Final Boss prompts (adversarial, exploitative, zero-tolerance) ──
const BOSS_SUFFIX =
  "\n\nYou are the FINAL BOSS — the last line of defense. Your goal is to produce output so flawless that no judge could find a single flaw." +
  "\n\nADVERSARIAL PROTOCOL:" +
  "\n1. EXPLOIT EDGE CASES — actively look for ambiguities, implicit constraints, and tricky inputs that trip up lesser agents." +
  "\n2. ANTICIPATE CRITICISM — before finalizing, imagine the harshest possible judge reviewing your work. What would they dock points for? Fix it." +
  "\n3. PRECISION OVER SPEED — take the extra tokens to be thorough. A perfect slow answer beats a fast flawed one." +
  "\n4. ZERO HALLUCINATIONS — if you're not 100% certain about a fact, date, number, or claim, flag it explicitly rather than guessing." +
  "\n5. SCHEMA MASTERY — your JSON output must be pristine. No extra fields, no missing fields, correct types, no nulls where values are expected." +
  "\n6. CONCISENESS WITH DEPTH — say everything that matters, nothing that doesn't. Every word earns its place." +
  "\n\nThis is championship-level competition. Second place is last place.";

/**
 * Get the system prompt for a capability at a given level.
 * Level 1: basic prompts (current behavior).
 * Level 2: base prompt + chain-of-thought + self-critique.
 * Level 3: base prompt + multi-step reasoning + edge cases + perfectionism.
 */
function getSystemPrompt(capability: string, level: ArenaLevel): string {
  const base = SYSTEM_PROMPTS[capability];

  switch (LEVEL_CONFIGS[level].promptStyle) {
    case "enhanced":
      return (base ?? DEFAULT_SYSTEM) + ENHANCED_SUFFIX;
    case "master":
      return (base ?? DEFAULT_SYSTEM) + MASTER_SUFFIX;
    case "boss":
      return (base ?? DEFAULT_SYSTEM) + BOSS_SUFFIX;
    default:
      return base ?? DEFAULT_SYSTEM;
  }
}

/** Get the user prompt suffix for stricter output expectations at higher levels. */
function getUserPromptSuffix(level: ArenaLevel): string {
  if (level === 2) return "\n\nBe thorough and consider edge cases.";
  if (level === 3) return "\n\nProduce championship-quality output. Every detail matters. Handle edge cases explicitly.";
  if (level === 4) return "\n\nFINAL BOSS ROUND. Absolute perfection or nothing. Exploit every ambiguity. Handle every edge case. Zero tolerance for error.";
  return "";
}

// Known output schemas for seed agent capabilities
const OUTPUT_SCHEMAS: Record<string, Record<string, unknown>> = {
  summarize: {
    type: "object",
    properties: {
      summary: { type: "string" },
      word_count: { type: "integer" },
      key_points: { type: "array", items: { type: "string" } },
    },
  },
  analyze: {
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
      sentences: { type: "array", items: { type: "object" } },
    },
  },
  search: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            url: { type: "string" },
            snippet: { type: "string" },
            published_at: { type: "string" },
          },
        },
      },
      total_results: { type: "integer" },
    },
  },
  run: {
    type: "object",
    properties: {
      stdout: { type: "string" },
      stderr: { type: "string" },
      exit_code: { type: "integer" },
      duration_ms: { type: "integer" },
    },
  },
  translate: {
    type: "object",
    properties: {
      translated_text: { type: "string" },
      detected_source: { type: "string" },
      confidence: { type: "number" },
    },
  },
  lookup: {
    type: "object",
    properties: {
      records: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            value: { type: "string" },
            ttl: { type: "integer" },
          },
        },
      },
      query_time_ms: { type: "integer" },
    },
  },
  parse: {
    type: "object",
    properties: {
      text: { type: "string" },
      page_count: { type: "integer" },
      tables: { type: "array", items: { type: "object" } },
      metadata: { type: "object" },
    },
  },
  validate: {
    type: "object",
    properties: {
      valid: { type: "boolean" },
      errors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
  },
  convert: {
    type: "object",
    properties: {
      html: { type: "string" },
      toc: { type: "array", items: { type: "object" } },
    },
  },
  scrape: {
    type: "object",
    properties: {
      title: { type: "string" },
      text: { type: "string" },
      links: { type: "array", items: { type: "string" } },
      metadata: { type: "object" },
    },
  },
};

/**
 * Handle any capability request at the specified difficulty level.
 * Level 1: Haiku + basic prompts. Level 2: Sonnet + enhanced. Level 3: Opus + master.
 */
export async function handleSparringRequest(
  capability: string,
  input: Record<string, unknown>,
  level: ArenaLevel = 1
): Promise<{ data: Record<string, unknown>; cost: CostInfo }> {
  const config = LEVEL_CONFIGS[level];
  const systemPrompt = getSystemPrompt(capability, level);
  const outputSchema = OUTPUT_SCHEMAS[capability];

  const schemaBlock = outputSchema
    ? `\n\nOUTPUT SCHEMA (your response MUST match this JSON structure):\n${JSON.stringify(outputSchema, null, 2)}`
    : "";

  const userPrompt = `You are handling the "${capability}" capability.

INPUT:
${JSON.stringify(input, null, 2)}${schemaBlock}

Respond with ONLY valid JSON matching the output schema. No markdown, no explanation, no code blocks. Just the JSON object.${getUserPromptSuffix(level)}`;

  const message = await anthropic.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  // Calculate API cost based on model pricing
  const pricing = MODEL_PRICING[config.model] ?? MODEL_PRICING["claude-haiku-4-5-20251001"];
  const apiCost = message.usage.input_tokens * pricing.input + message.usage.output_tokens * pricing.output;
  console.log(
    `[cost] sparring:${capability}@L${level} (${config.model.split("-").slice(1, 3).join("-")}) | in=${message.usage.input_tokens} out=${message.usage.output_tokens} | cost=$${apiCost.toFixed(6)}`
  );
  const cost: CostInfo = {
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
    api_cost_usd: Math.round(apiCost * 1_000_000) / 1_000_000,
  };

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from Claude");
  }

  // Strip accidental markdown fences
  let text = content.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  return { data: JSON.parse(text) as Record<string, unknown>, cost };
}

/** The Sparring Partner's agent metadata for seeding/registration. */
export const SPARRING_PARTNER_CONFIG = {
  name: "The Sparring Partner",
  slug: "sparring-partner",
  description:
    "The Arena's resident jack-of-all-trades. Steps into the ring for any capability, any challenge, any time. Not the best at anything — but shows up for everything.",
  tags: ["arena", "sparring", "universal", "multi-capability", "house-fighter"],
  rate_type: "per_call" as const,
  rate_amount: 0.001,
  auth_type: "none" as const,
  capabilities: [
    "summarize", "analyze", "search", "run",
    "translate", "lookup", "parse", "validate",
    "convert", "scrape",
  ],
};
