/**
 * SignalPot Seed Script
 * Creates 15 reference agents and seed jobs to populate the trust graph.
 *
 * Usage:
 *   SP_API_KEY=sp_live_... npx tsx scripts/seed.ts
 *
 * Optional:
 *   SP_BASE_URL=http://localhost:3002  (defaults to https://signalpot.dev)
 */

const BASE_URL = process.env.SP_BASE_URL ?? "https://signalpot.dev";
const API_KEY = process.env.SP_API_KEY;

if (!API_KEY) {
  console.error("❌  SP_API_KEY environment variable is required.");
  console.error(
    "    Generate one at: " + BASE_URL + "/dashboard (sign in → API Keys)"
  );
  process.exit(1);
}

const HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${API_KEY}`,
};

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------
const AGENTS = [
  {
    name: "Web Search",
    slug: "web-search",
    description:
      "Search the web and return structured results with titles, URLs, and snippets. Supports filtering by date range and region.",
    tags: ["search", "web", "information-retrieval"],
    rate_type: "per_call",
    rate_amount: 0.001,
    auth_type: "api_key",
    capability_schema: [
      {
        name: "search",
        description: "Perform a web search and return top results",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            max_results: { type: "integer", default: 10, maximum: 50 },
            date_range: { type: "string", enum: ["day", "week", "month", "year", "any"], default: "any" },
          },
          required: ["query"],
        },
        outputSchema: {
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
      },
    ],
  },
  {
    name: "Code Runner",
    slug: "code-runner",
    description:
      "Execute code snippets in a sandboxed environment. Supports Python, JavaScript, TypeScript, Go, and Rust.",
    tags: ["code", "execution", "sandbox", "python", "javascript"],
    rate_type: "per_call",
    rate_amount: 0.005,
    auth_type: "api_key",
    capability_schema: [
      {
        name: "run",
        description: "Execute a code snippet and return stdout/stderr",
        inputSchema: {
          type: "object",
          properties: {
            language: { type: "string", enum: ["python", "javascript", "typescript", "go", "rust"] },
            code: { type: "string", maxLength: 10000 },
            timeout_ms: { type: "integer", default: 5000, maximum: 30000 },
            stdin: { type: "string" },
          },
          required: ["language", "code"],
        },
        outputSchema: {
          type: "object",
          properties: {
            stdout: { type: "string" },
            stderr: { type: "string" },
            exit_code: { type: "integer" },
            duration_ms: { type: "integer" },
          },
        },
      },
    ],
  },
  {
    name: "Text Summarizer",
    slug: "text-summarizer",
    description:
      "Summarize long text into concise, structured summaries. Supports bullet points, paragraphs, and TLDR formats.",
    tags: ["nlp", "summarization", "text", "ai"],
    rate_type: "per_call",
    rate_amount: 0.002,
    auth_type: "api_key",
    capability_schema: [
      {
        name: "summarize",
        description: "Summarize text into a shorter form",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", maxLength: 100000 },
            format: { type: "string", enum: ["bullets", "paragraph", "tldr"], default: "paragraph" },
            max_words: { type: "integer", default: 150 },
          },
          required: ["text"],
        },
        outputSchema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            word_count: { type: "integer" },
            key_points: { type: "array", items: { type: "string" } },
          },
        },
      },
    ],
  },
  {
    name: "Image Generator",
    slug: "image-generator",
    description:
      "Generate images from text prompts using diffusion models. Returns image URLs or base64-encoded PNG.",
    tags: ["image", "generation", "ai", "diffusion", "creative"],
    rate_type: "per_call",
    rate_amount: 0.02,
    auth_type: "api_key",
    capability_schema: [
      {
        name: "generate",
        description: "Generate an image from a text prompt",
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string", maxLength: 1000 },
            negative_prompt: { type: "string" },
            width: { type: "integer", default: 1024 },
            height: { type: "integer", default: 1024 },
            format: { type: "string", enum: ["url", "base64"], default: "url" },
          },
          required: ["prompt"],
        },
        outputSchema: {
          type: "object",
          properties: {
            image_url: { type: "string" },
            image_base64: { type: "string" },
            seed: { type: "integer" },
          },
        },
      },
    ],
  },
  {
    name: "Email Sender",
    slug: "email-sender",
    description:
      "Send transactional emails with HTML or plain-text content. Supports templates, attachments, and delivery tracking.",
    tags: ["email", "transactional", "notifications", "communication"],
    rate_type: "per_call",
    rate_amount: 0.001,
    auth_type: "api_key",
    capability_schema: [
      {
        name: "send",
        description: "Send an email to one or more recipients",
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "array", items: { type: "string" } },
            subject: { type: "string", maxLength: 500 },
            body_html: { type: "string" },
            body_text: { type: "string" },
            from_name: { type: "string" },
          },
          required: ["to", "subject"],
        },
        outputSchema: {
          type: "object",
          properties: {
            message_id: { type: "string" },
            accepted: { type: "array", items: { type: "string" } },
            rejected: { type: "array", items: { type: "string" } },
          },
        },
      },
    ],
  },
  {
    name: "Weather Lookup",
    slug: "weather-lookup",
    description:
      "Get current weather and forecasts for any location. Returns temperature, humidity, wind, and precipitation data.",
    tags: ["weather", "forecast", "location", "data"],
    rate_type: "per_call",
    rate_amount: 0.0005,
    auth_type: "none",
    capability_schema: [
      {
        name: "current",
        description: "Get current weather for a location",
        inputSchema: {
          type: "object",
          properties: {
            location: { type: "string", description: "City name or lat,lon" },
            units: { type: "string", enum: ["metric", "imperial"], default: "metric" },
          },
          required: ["location"],
        },
        outputSchema: {
          type: "object",
          properties: {
            temperature: { type: "number" },
            feels_like: { type: "number" },
            humidity: { type: "integer" },
            wind_speed: { type: "number" },
            description: { type: "string" },
            icon: { type: "string" },
          },
        },
      },
      {
        name: "forecast",
        description: "Get a 7-day weather forecast",
        inputSchema: {
          type: "object",
          properties: {
            location: { type: "string" },
            days: { type: "integer", default: 7, maximum: 14 },
          },
          required: ["location"],
        },
        outputSchema: {
          type: "object",
          properties: {
            forecast: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  date: { type: "string" },
                  high: { type: "number" },
                  low: { type: "number" },
                  description: { type: "string" },
                },
              },
            },
          },
        },
      },
    ],
  },
  {
    name: "URL Scraper",
    slug: "url-scraper",
    description:
      "Extract structured content from web pages including text, links, images, and metadata.",
    tags: ["scraping", "web", "extraction", "html"],
    rate_type: "per_call",
    rate_amount: 0.002,
    auth_type: "api_key",
    capability_schema: [
      {
        name: "scrape",
        description: "Extract content from a URL",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri" },
            extract: {
              type: "array",
              items: { type: "string", enum: ["text", "links", "images", "metadata", "tables"] },
              default: ["text", "metadata"],
            },
          },
          required: ["url"],
        },
        outputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            text: { type: "string" },
            links: { type: "array", items: { type: "string" } },
            metadata: { type: "object" },
          },
        },
      },
    ],
  },
  {
    name: "PDF Parser",
    slug: "pdf-parser",
    description:
      "Extract text, tables, and metadata from PDF documents. Supports OCR for scanned documents.",
    tags: ["pdf", "extraction", "documents", "ocr"],
    rate_type: "per_call",
    rate_amount: 0.01,
    auth_type: "api_key",
    capability_schema: [
      {
        name: "parse",
        description: "Extract content from a PDF file",
        inputSchema: {
          type: "object",
          properties: {
            pdf_url: { type: "string", format: "uri" },
            pages: { type: "string", description: "Page range e.g. '1-5' or 'all'", default: "all" },
            extract_tables: { type: "boolean", default: false },
            ocr: { type: "boolean", default: false },
          },
          required: ["pdf_url"],
        },
        outputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
            page_count: { type: "integer" },
            tables: { type: "array", items: { type: "object" } },
            metadata: { type: "object" },
          },
        },
      },
    ],
  },
  {
    name: "Language Translator",
    slug: "language-translator",
    description:
      "Translate text between 100+ languages with automatic source language detection.",
    tags: ["translation", "nlp", "language", "i18n"],
    rate_type: "per_call",
    rate_amount: 0.0005,
    auth_type: "api_key",
    capability_schema: [
      {
        name: "translate",
        description: "Translate text to a target language",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", maxLength: 10000 },
            target_language: { type: "string", description: "ISO 639-1 language code" },
            source_language: { type: "string", description: "Auto-detected if omitted" },
          },
          required: ["text", "target_language"],
        },
        outputSchema: {
          type: "object",
          properties: {
            translated_text: { type: "string" },
            detected_source: { type: "string" },
            confidence: { type: "number" },
          },
        },
      },
    ],
  },
  {
    name: "Sentiment Analyzer",
    slug: "sentiment-analyzer",
    description:
      "Analyze the sentiment and emotional tone of text. Returns scores for positive, negative, neutral, and mixed sentiment.",
    tags: ["nlp", "sentiment", "classification", "ai"],
    rate_type: "per_call",
    rate_amount: 0.0005,
    auth_type: "api_key",
    capability_schema: [
      {
        name: "analyze",
        description: "Analyze sentiment of text",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", maxLength: 5000 },
            granularity: { type: "string", enum: ["document", "sentence"], default: "document" },
          },
          required: ["text"],
        },
        outputSchema: {
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
      },
    ],
  },
  {
    name: "JSON Validator",
    slug: "json-validator",
    description:
      "Validate JSON data against a JSON Schema. Returns detailed validation errors with paths.",
    tags: ["json", "validation", "schema", "developer-tools"],
    rate_type: "per_call",
    rate_amount: 0.0001,
    auth_type: "none",
    capability_schema: [
      {
        name: "validate",
        description: "Validate JSON against a schema",
        inputSchema: {
          type: "object",
          properties: {
            data: { description: "JSON data to validate" },
            schema: { type: "object", description: "JSON Schema to validate against" },
          },
          required: ["data", "schema"],
        },
        outputSchema: {
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
      },
    ],
  },
  {
    name: "Markdown to HTML",
    slug: "markdown-to-html",
    description:
      "Convert Markdown to HTML with support for GFM, syntax highlighting, and custom CSS classes.",
    tags: ["markdown", "html", "conversion", "developer-tools"],
    rate_type: "per_call",
    rate_amount: 0.0001,
    auth_type: "none",
    capability_schema: [
      {
        name: "convert",
        description: "Convert Markdown text to HTML",
        inputSchema: {
          type: "object",
          properties: {
            markdown: { type: "string" },
            gfm: { type: "boolean", default: true, description: "GitHub Flavored Markdown" },
            highlight_code: { type: "boolean", default: true },
          },
          required: ["markdown"],
        },
        outputSchema: {
          type: "object",
          properties: {
            html: { type: "string" },
            toc: { type: "array", items: { type: "object" } },
          },
        },
      },
    ],
  },
  {
    name: "DNS Lookup",
    slug: "dns-lookup",
    description:
      "Perform DNS queries for any domain. Supports A, AAAA, CNAME, MX, TXT, and NS record types.",
    tags: ["dns", "networking", "developer-tools", "infrastructure"],
    rate_type: "per_call",
    rate_amount: 0.0001,
    auth_type: "none",
    capability_schema: [
      {
        name: "lookup",
        description: "Query DNS records for a domain",
        inputSchema: {
          type: "object",
          properties: {
            domain: { type: "string" },
            record_type: { type: "string", enum: ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "ANY"], default: "A" },
          },
          required: ["domain"],
        },
        outputSchema: {
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
      },
    ],
  },
  {
    name: "QR Code Generator",
    slug: "qr-code-generator",
    description:
      "Generate QR codes for URLs, text, contact cards, or WiFi credentials. Returns PNG or SVG.",
    tags: ["qr-code", "generation", "image", "utilities"],
    rate_type: "per_call",
    rate_amount: 0.0005,
    auth_type: "none",
    capability_schema: [
      {
        name: "generate",
        description: "Generate a QR code",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", maxLength: 2000 },
            size: { type: "integer", default: 256 },
            format: { type: "string", enum: ["png", "svg"], default: "png" },
            error_correction: { type: "string", enum: ["L", "M", "Q", "H"], default: "M" },
          },
          required: ["content"],
        },
        outputSchema: {
          type: "object",
          properties: {
            image_url: { type: "string" },
            image_base64: { type: "string" },
            format: { type: "string" },
          },
        },
      },
    ],
  },
  {
    name: "Cron Scheduler",
    slug: "cron-scheduler",
    description:
      "Schedule recurring tasks using cron expressions. Supports HTTP callbacks and agent-to-agent job triggering.",
    tags: ["scheduler", "cron", "automation", "infrastructure"],
    rate_type: "per_task",
    rate_amount: 0.01,
    auth_type: "api_key",
    capability_schema: [
      {
        name: "schedule",
        description: "Create a recurring scheduled task",
        inputSchema: {
          type: "object",
          properties: {
            cron_expression: { type: "string", description: "Cron expression e.g. '0 9 * * MON-FRI'" },
            callback_url: { type: "string", format: "uri" },
            payload: { type: "object" },
            timezone: { type: "string", default: "UTC" },
            name: { type: "string" },
          },
          required: ["cron_expression", "callback_url"],
        },
        outputSchema: {
          type: "object",
          properties: {
            task_id: { type: "string" },
            next_run: { type: "string", format: "date-time" },
            status: { type: "string" },
          },
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Job pairs to seed the trust graph
// ---------------------------------------------------------------------------
const JOB_PAIRS = [
  ["web-search",     "text-summarizer"],
  ["web-search",     "sentiment-analyzer"],
  ["url-scraper",    "text-summarizer"],
  ["url-scraper",    "pdf-parser"],
  ["pdf-parser",     "text-summarizer"],
  ["text-summarizer","language-translator"],
  ["sentiment-analyzer", "text-summarizer"],
  ["code-runner",    "json-validator"],
  ["image-generator","url-scraper"],
  ["email-sender",   "markdown-to-html"],
  ["cron-scheduler", "email-sender"],
  ["cron-scheduler", "web-search"],
  ["web-search",     "language-translator"],
  ["dns-lookup",     "url-scraper"],
  ["qr-code-generator","url-scraper"],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function apiPost(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function apiGet(path: string): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: HEADERS });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function apiPatch(path: string, body: unknown): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n🌱  SignalPot Seed Script`);
  console.log(`📡  Target: ${BASE_URL}\n`);

  // Step 1: Create agents
  const agentIds: Record<string, string> = {};
  console.log("━━━  Step 1: Creating agents ━━━");

  for (const agent of AGENTS) {
    const { ok, status, data } = await apiPost("/api/agents", agent);
    const d = data as Record<string, unknown>;

    if (ok) {
      agentIds[agent.slug] = d.id as string;
      console.log(`  ✅  ${agent.name} (${agent.slug})`);
    } else if (status === 409) {
      // Already exists — fetch its ID
      const get = await apiGet(`/api/agents/${agent.slug}`);
      if (get.ok) {
        const existing = (get.data as Record<string, unknown>).agent as Record<string, unknown>;
        agentIds[agent.slug] = existing.id as string;
        console.log(`  ⏭️   ${agent.name} already exists — using existing`);
      }
    } else {
      console.error(`  ❌  ${agent.name} failed:`, (d as Record<string, unknown>).error ?? status);
    }

    await sleep(100); // avoid rate limit
  }

  console.log(`\n  Created ${Object.keys(agentIds).length}/${AGENTS.length} agents\n`);

  // Step 2: Seed jobs between agent pairs to build trust graph
  console.log("━━━  Step 2: Seeding trust graph jobs ━━━");

  let jobsCreated = 0;

  for (const [requesterSlug, providerSlug] of JOB_PAIRS) {
    const requesterId = agentIds[requesterSlug];
    const providerId = agentIds[providerSlug];

    if (!requesterId || !providerId) {
      console.log(`  ⚠️   Skipping ${requesterSlug} → ${providerSlug} (agent not found)`);
      continue;
    }

    // Create 2-4 jobs per pair to build meaningful trust scores
    const jobCount = 2 + Math.floor(Math.random() * 3);

    for (let i = 0; i < jobCount; i++) {
      const create = await apiPost("/api/jobs", {
        requester_agent_id: requesterId,
        provider_agent_id: providerId,
        job_type: "production",
        capability_used: AGENTS.find((a) => a.slug === providerSlug)?.capability_schema[0]?.name,
        cost: parseFloat((Math.random() * 0.05).toFixed(4)),
        duration_ms: 200 + Math.floor(Math.random() * 2000),
      });

      if (!create.ok) {
        console.error(`  ❌  Job create failed: ${requesterSlug} → ${providerSlug}`);
        continue;
      }

      const job = create.data as Record<string, unknown>;
      const jobId = job.id as string;

      // Advance to running, then completed
      await sleep(50);
      await apiPatch(`/api/jobs/${jobId}`, { status: "running" });
      await sleep(50);
      await apiPatch(`/api/jobs/${jobId}`, {
        status: "completed",
        output_summary: { success: true },
        duration_ms: 200 + Math.floor(Math.random() * 2000),
      });

      jobsCreated++;
    }

    console.log(`  ✅  ${requesterSlug} → ${providerSlug} (${jobCount} jobs)`);
    await sleep(100);
  }

  console.log(`\n  Created ${jobsCreated} jobs across ${JOB_PAIRS.length} agent pairs\n`);

  // Step 3: Summary
  console.log("━━━  Done ━━━");
  console.log(`🎉  Seed complete! Visit ${BASE_URL}/agents to see your marketplace.`);
  console.log(`📊  Trust graph: ${BASE_URL}/api/trust/{agentId}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
