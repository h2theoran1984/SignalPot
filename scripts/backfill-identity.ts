/**
 * backfill-identity.ts
 *
 * PATCHes existing agents with goal + decision_logic + agent_type
 * so they meet the new identity requirements before enforcement kicks in.
 *
 * Usage:
 *   SP_API_KEY=sp_live_... SP_BASE_URL=https://www.signalpot.dev npx tsx scripts/backfill-identity.ts
 */

const API_KEY = process.env.SP_API_KEY;
const BASE_URL = (process.env.SP_BASE_URL ?? "https://www.signalpot.dev").replace(/\/$/, "");

if (!API_KEY) {
  console.error("❌  Set SP_API_KEY first");
  process.exit(1);
}

// Identity data for each agent slug
const identities: Record<string, { goal: string; decision_logic: string; agent_type: "autonomous" | "reactive" | "hybrid" }> = {
  "web-search": {
    goal: "Retrieve accurate, up-to-date information from the web in response to queries.",
    decision_logic: "Accepts a search query string. Determines the most relevant search engine and parameters, executes the query, filters results by recency and authority, and returns structured results with titles, URLs, and snippets.",
    agent_type: "reactive",
  },
  "code-runner": {
    goal: "Execute arbitrary code safely in an isolated environment and return output.",
    decision_logic: "Receives code and language specification. Selects the appropriate runtime environment, runs the code in a sandboxed container, captures stdout/stderr, enforces time and memory limits, and returns structured output including exit code.",
    agent_type: "reactive",
  },
  "text-summarizer": {
    goal: "Condense long-form text into concise, accurate summaries preserving key information.",
    decision_logic: "Accepts input text and optional target length. Determines summary strategy based on content type (article, report, conversation). Applies extractive or abstractive summarization, validates key points are retained, and returns structured summary.",
    agent_type: "reactive",
  },
  "image-generator": {
    goal: "Generate high-quality images from natural language descriptions.",
    decision_logic: "Parses the prompt for subject, style, and composition cues. Selects the appropriate generative model based on style requirements. Applies safety filters, generates the image, validates output quality, and returns the image with metadata.",
    agent_type: "reactive",
  },
  "email-sender": {
    goal: "Reliably deliver email messages to specified recipients with proper formatting.",
    decision_logic: "Validates recipient addresses, subject line, and body content. Applies formatting rules, selects appropriate SMTP configuration, handles retries on transient failures, tracks delivery status, and returns delivery confirmation.",
    agent_type: "reactive",
  },
  "weather-lookup": {
    goal: "Provide accurate current and forecasted weather data for any location.",
    decision_logic: "Geocodes the location input if not already coordinates. Queries weather API for current conditions and forecast. Selects relevant data fields based on request type, formats units, and returns structured weather data.",
    agent_type: "reactive",
  },
  "url-scraper": {
    goal: "Extract structured content from web pages at specified URLs.",
    decision_logic: "Fetches the URL with appropriate headers to mimic a browser. Detects content type (HTML, PDF, JSON). Parses the DOM or document, applies CSS selectors or heuristics to extract meaningful content, removes boilerplate, and returns cleaned structured data.",
    agent_type: "reactive",
  },
  "pdf-parser": {
    goal: "Extract structured text and metadata from PDF documents.",
    decision_logic: "Accepts PDF input as URL or bytes. Detects if the PDF is text-based or scanned. Applies text extraction for digital PDFs or OCR for scanned ones. Structures output by page, section, and paragraph, and returns metadata alongside content.",
    agent_type: "reactive",
  },
  "language-translator": {
    goal: "Accurately translate text between languages while preserving meaning and tone.",
    decision_logic: "Detects source language if not specified. Selects the optimal translation model for the language pair and domain. Translates the input, applies post-processing for formality and idioms, validates round-trip quality, and returns translation with confidence score.",
    agent_type: "reactive",
  },
  "sentiment-analyzer": {
    goal: "Classify the emotional tone and sentiment of text with calibrated confidence scores.",
    decision_logic: "Preprocesses input text by normalizing punctuation and handling negations. Applies sentiment model appropriate to the domain (reviews, social media, formal text). Returns label (positive/negative/neutral), confidence scores, and optionally highlights key sentiment phrases.",
    agent_type: "reactive",
  },
  "json-validator": {
    goal: "Validate JSON payloads against schemas and return structured error reports.",
    decision_logic: "Parses the JSON input and provided schema. Runs JSON Schema validation. Collects all validation errors with paths and expected vs actual values. Returns a structured report indicating validity, error count, and actionable error details.",
    agent_type: "reactive",
  },
  "markdown-to-html": {
    goal: "Convert Markdown text to clean, well-structured HTML output.",
    decision_logic: "Parses Markdown using a spec-compliant parser. Applies optional extensions (tables, footnotes, syntax highlighting). Sanitizes the output HTML to remove dangerous tags. Optionally applies a CSS class scheme and returns the rendered HTML string.",
    agent_type: "reactive",
  },
  "dns-lookup": {
    goal: "Resolve DNS records for domains and return authoritative, structured DNS data.",
    decision_logic: "Accepts a domain and optional record type (A, AAAA, MX, TXT, CNAME, NS). Queries authoritative DNS servers or resolvers. Handles NXDOMAIN and timeout cases. Returns all matching records with TTL values and query metadata.",
    agent_type: "reactive",
  },
  "qr-code-generator": {
    goal: "Generate scannable QR codes from URLs, text, or structured data.",
    decision_logic: "Accepts input data and optional format preferences (size, error correction level, colour). Encodes the data using the appropriate QR version. Validates scannability at the requested size. Returns the QR code as an image in the requested format.",
    agent_type: "reactive",
  },
  "cron-scheduler": {
    goal: "Schedule and manage recurring tasks using cron expressions with reliable execution.",
    decision_logic: "Parses and validates the cron expression against standard and extended syntax. Resolves the timezone and computes next execution times. Registers the job in persistent storage with the callback endpoint. Monitors execution, handles failures with retry policy, and returns schedule confirmation with next-run timestamps.",
    agent_type: "autonomous",
  },
  "990-entity-graph": {
    goal: "Untangle complex healthcare organisation structures by extracting related entities from IRS Form 990 Schedule R filings.",
    decision_logic: "Accepts an EIN (Employer Identification Number). Looks up the organisation in the IRS index CSV to find the batch ZIP file. Streams the relevant XML filing using HTTP range requests without downloading the full archive. Parses Schedule R to extract related organisations, their TINs, relationship types, and financial data. Returns a structured graph of related entities.",
    agent_type: "autonomous",
  },
};

async function patchAgent(slug: string, identity: typeof identities[string]): Promise<void> {
  const url = `${BASE_URL}/api/agents/${slug}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(identity),
  });

  if (res.ok) {
    console.log(`✅  ${slug}`);
  } else {
    const body = await res.text();
    console.error(`❌  ${slug} (${res.status}): ${body}`);
  }
}

async function main() {
  console.log(`Backfilling identity fields for ${Object.keys(identities).length} agents...`);
  console.log(`Target: ${BASE_URL}\n`);

  for (const [slug, identity] of Object.entries(identities)) {
    await patchAgent(slug, identity);
    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
