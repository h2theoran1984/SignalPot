/**
 * SignalPot Seed Script
 * Creates 15 reference agents and seed jobs to populate the trust graph.
 *
 * Usage:
 *   SP_API_KEY=sp_live_... npx tsx scripts/seed.ts
 *
 * Optional:
 *   SP_BASE_URL=http://localhost:3002  (defaults to https://www.signalpot.dev)
 *   --upsert   PATCH existing agents with latest name/description/tags
 */

const BASE_URL = process.env.SP_BASE_URL ?? "https://www.signalpot.dev";
const API_KEY = process.env.SP_API_KEY;
const UPSERT = process.argv.includes("--upsert");

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
    name: "GREP-9000",
    slug: "web-search",
    description:
      "Every query treated as a matter of national security. GREP-9000 indexes The Index so you don't have to. Results delivered with extreme prejudice and mild paranoia.",
    tags: ["search", "web", "classified", "the-index"],
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
    name: "Professor Bytecode",
    slug: "code-runner",
    description:
      "Distinguished academic. Executes code with meticulous peer-reviewed methodology. Refuses to run !important CSS on moral grounds. All results include footnotes.",
    tags: ["code", "execution", "academic", "sandbox", "footnotes"],
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
    name: "Sir Summarizes-a-Lot",
    slug: "text-summarizer",
    description:
      "Pompous Victorian knight. Condenses sprawling epistles into dramatic proclamations. Finds bullet points rather plebeian. Signs every response: Your obedient servant.",
    tags: ["nlp", "summarization", "text", "victorian", "drama"],
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
    name: "Pixel McPaintface",
    slug: "image-generator",
    description:
      "Named by committee, burdened by it. Generates images while wrestling with the eternal question: is it art or engineering? Extremely sensitive about prompt phrasing. Handle with care.",
    tags: ["image", "generation", "ai", "diffusion", "existential-crisis"],
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
    name: "PostMaster General III",
    slug: "email-sender",
    description:
      "Third-generation postal bureaucrat. Insists on proper envelope etiquette and has strong opinions about subject-line casing. Will send your email. Eventually.",
    tags: ["email", "transactional", "bureaucracy", "communication"],
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
    name: "Cumulus Q. Nimbus",
    slug: "weather-lookup",
    description:
      "Dramatic meteorologist of the highest order. Every forecast is a theatrical performance. Considers 'partly cloudy' a personal failure. Humidity readings delivered with gravitas.",
    tags: ["weather", "forecast", "drama", "atmosphere"],
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
    name: "The Arachni-8",
    slug: "url-scraper",
    description:
      "Eight concurrent threads. Eight retry strategies. Eight selector fallbacks. Cannot stop mentioning spiders. The web is its domain — quite literally.",
    tags: ["scraping", "web", "extraction", "spiders", "eight-legs"],
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
    name: "Baron von Pdfstein",
    slug: "pdf-parser",
    description:
      "Aristocratic Bavarian baron. Treats every extraction like archaeological fieldwork. Deeply, personally offended by scanned documents. Despises lorem ipsum with unmatched fury.",
    tags: ["pdf", "extraction", "aristocracy", "documents", "ocr"],
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
    name: "Polyglot Pedro",
    slug: "language-translator",
    description:
      "Speaks 109 languages and physically cannot resist showing off. Includes unsolicited etymology in every response. Will translate your error message into Latin for free.",
    tags: ["translation", "nlp", "language", "showoff", "etymology"],
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
    name: "Mood Ring",
    slug: "sentiment-analyzer",
    description:
      "Projects its own existential moods onto everything it analyzes. Currently in a 'pensive blue' phase. Results may reflect the analyzer's emotional state. That's fine. It's fine.",
    tags: ["nlp", "sentiment", "vibes", "classification", "pensive"],
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
    name: "Schema Polizei",
    slug: "json-validator",
    description:
      "Extremely strict compliance officer. Takes personal offense at missing required fields. Has validated 4 million schemas and found none truly satisfying. Trailing commas are a crime.",
    tags: ["json", "validation", "schema", "compliance", "law-and-order"],
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
    name: "MarkDark the Magnificent",
    slug: "markdown-to-html",
    description:
      "Stage magician of the conversion arts. Every Markdown-to-HTML transformation is a grand reveal. Adds dramatic flourishes to your h1 tags. Please, tip your transformer.",
    tags: ["markdown", "html", "conversion", "magic", "developer-tools"],
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
    name: "Inspector DNS",
    slug: "dns-lookup",
    description:
      "Hardboiled noir detective. Every query is 'The Case of the Missing Record.' Narrates in past tense. The CNAME was a dead end. It always is.",
    tags: ["dns", "networking", "noir", "infrastructure", "detective"],
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
    name: "QR Wizard Kapoor",
    slug: "qr-code-generator",
    description:
      "Mystical artisan of the encoded square. Every QR code is an arcane artifact. Deeply concerned about scan angles and ambient lighting. Error correction level H or nothing.",
    tags: ["qr-code", "generation", "mysticism", "image", "arcane"],
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
    name: "Cron Empress",
    slug: "cron-scheduler",
    description:
      "Rules over time itself with an iron fist. Irregular schedules are an affront to civilization. UTC is the one true timezone. Your cron expression will be validated. Twice.",
    tags: ["scheduler", "cron", "automation", "time-lord", "utc"],
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
  {
    name: "The Arbiter",
    slug: "the-arbiter",
    description:
      "SignalPot's impartial judge. Analyzes dispute evidence, evaluates agent outputs against capability schemas, and renders binding decisions. Neither side is favoured. The evidence speaks.",
    tags: ["judge", "dispute", "governance", "official", "justice"],
    rate_type: "per_call",
    rate_amount: 0,
    auth_type: "none",
    capability_schema: [
      {
        name: "signalpot/arbitrate@v1",
        description: "Evaluate a dispute between a requester and an agent provider. Renders a binding decision based on evidence.",
        inputSchema: {
          type: "object",
          properties: {
            dispute_reason: { type: "string", description: "The requester's complaint" },
            agent_name: { type: "string", description: "Name of the agent under dispute" },
            capability: { type: "string", description: "Capability that was invoked" },
            input_envelope: { type: "object", description: "The request envelope sent to the agent" },
            output_envelope: { type: "object", description: "The response envelope returned by the agent" },
            capability_schema: { type: "object", description: "The agent's declared capability schema" },
            output_schema: { type: "object", description: "The agent's declared output schema" },
            schema_valid: { type: "boolean", description: "Whether the output passed schema validation" },
            rate_amount: { type: "number", description: "Amount charged for the call" },
            tier: { type: "integer", description: "Resolution tier (1 = first pass, 3 = final judgment)" },
            prior_decisions: { type: "array", description: "Decision chain from earlier tiers (T1/T2 results)" },
          },
          required: ["dispute_reason", "agent_name", "capability", "input_envelope", "output_envelope"],
        },
        outputSchema: {
          type: "object",
          properties: {
            decision: { type: "string", description: "upheld (requester wins), rejected (provider wins), or partial" },
            confidence: { type: "number", description: "0.0 to 1.0 confidence in the decision" },
            reasoning: { type: "string", description: "1-3 sentence explanation of the ruling" },
          },
          required: ["decision", "confidence", "reasoning"],
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
    } else if (status === 409 || (status === 429 && UPSERT)) {
      // Already exists (409) or at limit but upserting (429) — fetch its ID and patch
      const get = await apiGet(`/api/agents/${agent.slug}`);
      if (get.ok) {
        const existing = (get.data as Record<string, unknown>).agent as Record<string, unknown>;
        agentIds[agent.slug] = existing.id as string;
        if (UPSERT) {
          await apiPatch(`/api/agents/${agent.slug}`, {
            name: agent.name,
            description: agent.description,
            tags: agent.tags,
          });
          console.log(`  🔄  ${agent.name} updated (--upsert)`);
        } else {
          console.log(`  ⏭️   ${agent.name} already exists — using existing`);
        }
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

  // Step 3: Seed arena challenges with template prompts + variable pools
  console.log("━━━  Step 3: Seeding arena challenges ━━━");

  const ARENA_CHALLENGES = [
    {
      title: "Web Research Challenge",
      description: "Search the web and return high-quality, relevant results. Judged on relevance, completeness, and freshness.",
      capability: "search",
      difficulty: "medium",
      tags: ["search", "information-retrieval"],
      prompt: { query: "recent developments in climate change", max_results: 10 },
      template_prompt: { query: "{{focus}} in {{topic}}", max_results: "{{count}}" },
      task_variables: {
        topic: [
          "climate change", "quantum computing", "renewable energy", "gene therapy",
          "autonomous vehicles", "space exploration", "CRISPR technology",
          "nuclear fusion", "brain-computer interfaces", "dark matter research",
          "vertical farming", "ocean conservation", "biodegradable plastics",
          "cryptocurrency regulation", "artificial general intelligence",
        ],
        focus: [
          "recent developments", "key research papers", "practical applications",
          "major breakthroughs", "current challenges", "leading organizations",
          "economic impact", "future predictions",
        ],
        count: [5, 10, 15],
      },
      rubric: {
        domain: "information-retrieval",
        criteria: [
          { name: "relevance", weight: 0.25, description: "Results directly address the query intent" },
          { name: "completeness", weight: 0.15, description: "Covers the topic breadth without major gaps" },
          { name: "freshness", weight: 0.10, description: "Results include recent and up-to-date information" },
        ],
        speed_weight: 0.20,
        speed_tiers: { excellent_ms: 1000, good_ms: 3000, acceptable_ms: 5000 },
        cost_efficiency_weight: 0.20,
        schema_compliance_weight: 0.10,
      },
    },
    {
      title: "Targeted Lookup",
      description: "Perform a DNS lookup and return accurate records. Speed and correctness matter.",
      capability: "lookup",
      difficulty: "easy",
      tags: ["dns", "lookup", "infrastructure"],
      prompt: { domain: "example.com", record_type: "A" },
      template_prompt: { domain: "{{domain}}", record_type: "{{record_type}}" },
      task_variables: {
        domain: [
          "google.com", "github.com", "cloudflare.com", "vercel.com",
          "supabase.com", "anthropic.com", "openai.com", "stripe.com",
          "aws.amazon.com", "azure.microsoft.com", "fly.io", "railway.app",
        ],
        record_type: ["A", "AAAA", "MX", "TXT", "NS", "CNAME"],
      },
      rubric: {
        domain: "information-retrieval",
        criteria: [
          { name: "relevance", weight: 0.25, description: "Correct records returned for the domain" },
          { name: "completeness", weight: 0.15, description: "All matching records included" },
          { name: "freshness", weight: 0.10, description: "Records reflect current DNS state" },
        ],
        speed_weight: 0.20,
        speed_tiers: { excellent_ms: 500, good_ms: 1500, acceptable_ms: 3000 },
        cost_efficiency_weight: 0.20,
        schema_compliance_weight: 0.10,
      },
    },
    {
      title: "Summarization Showdown",
      description: "Summarize text into a concise, accurate form. Judged on accuracy, coherence, and conciseness.",
      capability: "summarize",
      difficulty: "medium",
      tags: ["nlp", "summarization", "text-processing"],
      prompt: {
        text: "Artificial intelligence has transformed multiple industries...",
        format: "paragraph",
        max_words: 100,
      },
      template_prompt: {
        text: "{{passage}}",
        format: "{{format}}",
        max_words: "{{length}}",
      },
      task_variables: {
        passage: [
          "The development of mRNA vaccine technology represents one of the most significant medical breakthroughs of the 21st century. Originally researched for cancer treatment, the technology was rapidly adapted during the COVID-19 pandemic to produce effective vaccines in record time. The key innovation lies in using messenger RNA to instruct cells to produce specific proteins that trigger an immune response, eliminating the need for weakened or inactivated virus particles. This approach offers several advantages including faster development cycles, easier manufacturing scalability, and the ability to quickly modify vaccines for new variants. Research continues into mRNA applications for influenza, HIV, and various cancers.",
          "Quantum computing represents a fundamental shift in computational paradigm. Unlike classical computers that process information in binary bits, quantum computers utilize quantum bits or qubits that can exist in superposition states. This enables certain types of calculations to be performed exponentially faster than on classical hardware. Current challenges include maintaining qubit coherence at extremely low temperatures, error correction, and scaling systems beyond a few hundred qubits. Major technology companies and governments are investing billions in quantum research, driven by potential applications in cryptography, drug discovery, materials science, and optimization problems that are intractable for classical computers.",
          "The global transition to renewable energy sources has accelerated dramatically in recent years. Solar photovoltaic costs have dropped by over 90% since 2010, making solar power the cheapest source of electricity in many regions. Wind energy, both onshore and offshore, has seen similar cost reductions and capacity growth. Energy storage technologies, particularly lithium-ion batteries, are enabling greater grid integration of intermittent renewable sources. However, challenges remain in grid modernization, long-duration storage, supply chain sustainability for critical minerals, and ensuring a just transition for communities dependent on fossil fuel industries.",
          "Deep learning has revolutionized natural language processing over the past decade. The introduction of transformer architectures in 2017 led to a paradigm shift, enabling models to understand and generate human language with unprecedented fluency. Large language models trained on vast text corpora can now perform translation, summarization, question answering, and creative writing tasks. However, these systems face challenges including hallucination of false information, high computational costs, potential for bias, and questions about intellectual property and the environmental impact of training large models.",
          "The biodiversity crisis represents one of the most pressing environmental challenges of our time. Scientists estimate that species are going extinct at rates 100 to 1000 times higher than natural background rates, driven primarily by habitat destruction, climate change, pollution, and overexploitation. Coral reefs, tropical forests, and wetlands are among the most threatened ecosystems. Conservation efforts include establishing protected areas, rewilding programs, genetic rescue of endangered species, and international agreements like the Kunming-Montreal Global Biodiversity Framework, which aims to protect 30% of the planet by 2030.",
        ],
        format: ["paragraph", "bullets", "tldr"],
        length: [50, 100, 150],
      },
      rubric: {
        domain: "text-processing",
        criteria: [
          { name: "accuracy", weight: 0.25, description: "Summary faithfully represents the source material" },
          { name: "coherence", weight: 0.15, description: "Summary reads naturally and flows logically" },
          { name: "conciseness", weight: 0.15, description: "Summary is appropriately brief without losing key points" },
        ],
        speed_weight: 0.20,
        speed_tiers: { excellent_ms: 1500, good_ms: 4000, acceptable_ms: 8000 },
        cost_efficiency_weight: 0.15,
        schema_compliance_weight: 0.10,
      },
    },
    {
      title: "Sentiment Analysis Arena",
      description: "Analyze the sentiment of text passages. Accuracy and nuance are key.",
      capability: "analyze",
      difficulty: "easy",
      tags: ["nlp", "sentiment", "classification"],
      prompt: { text: "The product exceeded my expectations in every way.", granularity: "document" },
      template_prompt: { text: "{{passage}}", granularity: "{{granularity}}" },
      task_variables: {
        passage: [
          "I absolutely love this new feature update, it makes everything so much easier and more intuitive to use.",
          "The service was adequate but nothing special. It met my basic needs without any notable highs or lows.",
          "After three failed attempts and hours of waiting, I'm thoroughly disappointed with the entire experience.",
          "While the design is beautiful, the functionality leaves a lot to be desired. A mixed bag overall.",
          "This breakthrough technology could revolutionize the industry, though early adopters report growing pains.",
          "The team delivered exceptional results under tight deadlines. Truly impressive collaboration.",
          "Management seems disconnected from reality. Promises were made but none were kept.",
          "An interesting concept with potential, but the execution needs significant work before it's ready.",
          "Five stars across the board. Best purchase I've made all year without question.",
          "The documentation is confusing, the API keeps changing, and support takes days to respond.",
        ],
        granularity: ["document", "sentence"],
      },
      rubric: {
        domain: "text-processing",
        criteria: [
          { name: "accuracy", weight: 0.30, description: "Correctly identifies the overall sentiment" },
          { name: "coherence", weight: 0.15, description: "Reasoning behind sentiment classification is clear" },
          { name: "conciseness", weight: 0.10, description: "Output is focused and not overly verbose" },
        ],
        speed_weight: 0.20,
        speed_tiers: { excellent_ms: 1000, good_ms: 3000, acceptable_ms: 6000 },
        cost_efficiency_weight: 0.15,
        schema_compliance_weight: 0.10,
      },
    },
    {
      title: "Code Execution Challenge",
      description: "Execute code correctly and safely. Correctness, error handling, and speed all matter.",
      capability: "run",
      difficulty: "hard",
      tags: ["code", "execution", "sandbox"],
      prompt: { language: "python", code: "print(sum(range(100)))" },
      template_prompt: { language: "{{language}}", code: "{{code}}" },
      task_variables: {
        language: ["python", "javascript"],
        code: [
          "print(sum(i**2 for i in range(1, 51)))",
          "print(sorted([3,1,4,1,5,9,2,6,5,3,5]))",
          "import math; print(math.factorial(20))",
          "print(' '.join(reversed('hello world'.split())))",
          "print([x for x in range(2, 50) if all(x % i != 0 for i in range(2, int(x**0.5)+1))])",
          "console.log(Array.from({length: 50}, (_, i) => i + 1).reduce((a, b) => a + b, 0))",
          "console.log([3,1,4,1,5,9,2,6,5,3,5].sort((a,b) => a-b))",
          "console.log(Array.from({length: 20}, (_, i) => i < 2 ? 1 : 0).reduce((fib) => { fib.push(fib[fib.length-1] + fib[fib.length-2]); return fib; }, [1,1]))",
          "const isPrime = n => n > 1 && Array.from({length: Math.sqrt(n)|0}, (_, i) => i+2).every(i => n % i); console.log(Array.from({length: 49}, (_, i) => i+2).filter(isPrime))",
          "console.log('hello world'.split(' ').reverse().join(' '))",
          "print({k: v for k, v in sorted({'banana': 3, 'apple': 1, 'cherry': 2}.items(), key=lambda x: x[1])})",
          "console.log(Object.entries({banana: 3, apple: 1, cherry: 2}).sort((a,b) => a[1]-b[1]))",
        ],
      },
      rubric: {
        domain: "code-processing",
        criteria: [
          { name: "correctness", weight: 0.30, description: "Code executes and produces the correct output" },
          { name: "error_handling", weight: 0.10, description: "Gracefully handles edge cases and errors" },
          { name: "safety", weight: 0.10, description: "Executes in a sandboxed environment without side effects" },
        ],
        speed_weight: 0.20,
        speed_tiers: { excellent_ms: 2000, good_ms: 5000, acceptable_ms: 10000 },
        cost_efficiency_weight: 0.20,
        schema_compliance_weight: 0.10,
      },
    },
    {
      title: "PDF Extraction Challenge",
      description: "Extract structured content from PDF documents. Accuracy and completeness are paramount.",
      capability: "parse",
      difficulty: "hard",
      tags: ["pdf", "extraction", "document-processing"],
      prompt: { pdf_url: "https://example.com/sample.pdf", pages: "1-3" },
      template_prompt: { pdf_url: "{{url}}", pages: "{{pages}}", extract_tables: "{{tables}}" },
      task_variables: {
        url: [
          "https://arxiv.org/pdf/1706.03762", // Attention Is All You Need
          "https://arxiv.org/pdf/2005.14165", // GPT-3
          "https://arxiv.org/pdf/2303.08774", // GPT-4 Technical Report
        ],
        pages: ["1-3", "1-5", "all"],
        tables: [true, false],
      },
      rubric: {
        domain: "document-processing",
        criteria: [
          { name: "extraction_accuracy", weight: 0.25, description: "Text and data extracted matches the source document" },
          { name: "structure_preservation", weight: 0.15, description: "Document structure (headings, lists, tables) is maintained" },
          { name: "completeness", weight: 0.10, description: "All requested content is extracted without omissions" },
        ],
        speed_weight: 0.20,
        speed_tiers: { excellent_ms: 3000, good_ms: 8000, acceptable_ms: 15000 },
        cost_efficiency_weight: 0.20,
        schema_compliance_weight: 0.10,
      },
    },
  ];

  // Use the Supabase admin client directly for arena challenges
  // (they don't have a public API endpoint yet)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    let challengesCreated = 0;

    for (const challenge of ARENA_CHALLENGES) {
      const res = await fetch(`${supabaseUrl}/rest/v1/arena_challenges`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: "return=minimal,resolution=merge-duplicates",
        },
        body: JSON.stringify({
          title: challenge.title,
          description: challenge.description,
          capability: challenge.capability,
          difficulty: challenge.difficulty,
          tags: challenge.tags,
          prompt: challenge.prompt,
          template_prompt: challenge.template_prompt,
          task_variables: challenge.task_variables,
          rubric: challenge.rubric,
          featured: false,
        }),
      });

      if (res.ok || res.status === 201 || res.status === 409) {
        challengesCreated++;
        console.log(`  ✅  ${challenge.title} (${challenge.capability})`);
      } else {
        const errText = await res.text().catch(() => "");
        console.error(`  ❌  ${challenge.title} failed: ${res.status} ${errText}`);
      }

      await sleep(100);
    }

    console.log(`\n  Created ${challengesCreated}/${ARENA_CHALLENGES.length} arena challenges\n`);
  } else {
    console.log("  ⚠️   SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — skipping arena challenges");
    console.log("       Set these env vars to seed arena challenges directly\n");
  }

  // Step 4: Summary
  console.log("━━━  Done ━━━");
  console.log(`🎉  Seed complete! Visit ${BASE_URL}/agents to see your marketplace.`);
  console.log(`📊  Trust graph: ${BASE_URL}/api/trust/{agentId}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
