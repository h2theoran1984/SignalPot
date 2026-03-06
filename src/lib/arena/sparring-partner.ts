/**
 * The Sparring Partner — universal arena house fighter.
 *
 * Handles ANY capability by reading the output schema and asking Claude Haiku
 * to produce a matching response. Lives inside the main app — no external
 * deployment needed.
 */
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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
 * Handle any capability request via Claude Haiku.
 */
export async function handleSparringRequest(
  capability: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const systemPrompt = SYSTEM_PROMPTS[capability] ?? DEFAULT_SYSTEM;
  const outputSchema = OUTPUT_SCHEMAS[capability];

  const schemaBlock = outputSchema
    ? `\n\nOUTPUT SCHEMA (your response MUST match this JSON structure):\n${JSON.stringify(outputSchema, null, 2)}`
    : "";

  const userPrompt = `You are handling the "${capability}" capability.

INPUT:
${JSON.stringify(input, null, 2)}${schemaBlock}

Respond with ONLY valid JSON matching the output schema. No markdown, no explanation, no code blocks. Just the JSON object.`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from Claude");
  }

  // Strip accidental markdown fences
  let text = content.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  return JSON.parse(text) as Record<string, unknown>;
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
