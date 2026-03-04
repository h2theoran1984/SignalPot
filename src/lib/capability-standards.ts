export interface CapabilityStandard {
  id: string;           // e.g. "signalpot/web-search@v1"
  name: string;         // Human-readable name
  description: string;
  version: string;      // "v1", "v2", etc.
  category: string;     // "search", "text", "code", "data", "media", "util"
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  tags: string[];
}

export const CAPABILITY_STANDARDS: CapabilityStandard[] = [
  {
    id: "signalpot/web-search@v1",
    name: "Web Search",
    description: "Search the web and return ranked results with titles, URLs, and snippets.",
    version: "v1",
    category: "search",
    tags: ["search", "web", "information-retrieval"],
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "The search query" },
        max_results: { type: "number", description: "Max number of results (default 10)" },
        language: { type: "string", description: "Language code e.g. 'en'" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["results"],
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "url", "snippet"],
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              snippet: { type: "string" },
            },
          },
        },
        total_found: { type: "number" },
      },
    },
  },
  {
    id: "signalpot/text-summary@v1",
    name: "Text Summarization",
    description: "Summarize long text into a concise summary with key points.",
    version: "v1",
    category: "text",
    tags: ["text", "nlp", "summarization"],
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "Text to summarize" },
        max_length: { type: "number", description: "Max summary length in words" },
        format: { type: "string", enum: ["paragraph", "bullets"], description: "Output format" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["summary"],
      properties: {
        summary: { type: "string" },
        key_points: { type: "array", items: { type: "string" } },
        word_count: { type: "number" },
      },
    },
  },
  {
    id: "signalpot/code-exec@v1",
    name: "Code Execution",
    description: "Execute code in a sandboxed environment and return output.",
    version: "v1",
    category: "code",
    tags: ["code", "execution", "sandbox"],
    inputSchema: {
      type: "object",
      required: ["code", "language"],
      properties: {
        code: { type: "string", description: "Code to execute" },
        language: { type: "string", enum: ["python", "javascript", "typescript", "bash"] },
        timeout_ms: { type: "number", description: "Max execution time in ms (default 5000)" },
        stdin: { type: "string", description: "Standard input" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["stdout", "exit_code"],
      properties: {
        stdout: { type: "string" },
        stderr: { type: "string" },
        exit_code: { type: "number" },
        duration_ms: { type: "number" },
      },
    },
  },
  {
    id: "signalpot/data-extract@v1",
    name: "Data Extraction",
    description: "Extract structured data from unstructured text or documents.",
    version: "v1",
    category: "data",
    tags: ["data", "extraction", "parsing", "nlp"],
    inputSchema: {
      type: "object",
      required: ["text", "schema"],
      properties: {
        text: { type: "string", description: "Source text to extract from" },
        schema: { type: "object", description: "JSON Schema describing the data to extract" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["data", "confidence"],
      properties: {
        data: { type: "object", description: "Extracted data matching input schema" },
        confidence: { type: "number", description: "Confidence score 0-1" },
        missing_fields: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    id: "signalpot/image-analyze@v1",
    name: "Image Analysis",
    description: "Analyze images and return descriptions, labels, or extracted text.",
    version: "v1",
    category: "media",
    tags: ["image", "vision", "ocr", "media"],
    inputSchema: {
      type: "object",
      required: ["image_url"],
      properties: {
        image_url: { type: "string", description: "URL of the image to analyze" },
        tasks: {
          type: "array",
          items: { type: "string", enum: ["describe", "label", "ocr", "detect-objects"] },
          description: "Analysis tasks to perform",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        description: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        text: { type: "string", description: "OCR extracted text" },
        objects: { type: "array", items: { type: "object" } },
      },
    },
  },
  {
    id: "signalpot/email-send@v1",
    name: "Email Send",
    description: "Send an email to one or more recipients.",
    version: "v1",
    category: "util",
    tags: ["email", "communication", "notification"],
    inputSchema: {
      type: "object",
      required: ["to", "subject", "body"],
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string" },
        body: { type: "string", description: "Email body (plain text or HTML)" },
        cc: { type: "string" },
        reply_to: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["sent", "message_id"],
      properties: {
        sent: { type: "boolean" },
        message_id: { type: "string" },
      },
    },
  },
  {
    id: "signalpot/translate@v1",
    name: "Text Translation",
    description: "Translate text between languages.",
    version: "v1",
    category: "text",
    tags: ["translation", "language", "nlp"],
    inputSchema: {
      type: "object",
      required: ["text", "target_language"],
      properties: {
        text: { type: "string" },
        source_language: { type: "string", description: "Source language code (auto-detect if omitted)" },
        target_language: { type: "string", description: "Target language code e.g. 'es', 'fr', 'de'" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["translated_text", "target_language"],
      properties: {
        translated_text: { type: "string" },
        source_language: { type: "string" },
        target_language: { type: "string" },
        confidence: { type: "number" },
      },
    },
  },
  {
    id: "signalpot/sentiment@v1",
    name: "Sentiment Analysis",
    description: "Analyze sentiment and emotion in text.",
    version: "v1",
    category: "text",
    tags: ["sentiment", "nlp", "classification"],
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string" },
        granularity: { type: "string", enum: ["document", "sentence"], description: "Analysis granularity" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["sentiment", "score"],
      properties: {
        sentiment: { type: "string", enum: ["positive", "negative", "neutral", "mixed"] },
        score: { type: "number", description: "Sentiment score -1 to 1" },
        emotions: { type: "object", description: "Emotion breakdown" },
      },
    },
  },
];

export function getStandardById(id: string): CapabilityStandard | undefined {
  return CAPABILITY_STANDARDS.find((s) => s.id === id);
}

export function getStandardsByCategory(category: string): CapabilityStandard[] {
  return CAPABILITY_STANDARDS.filter((s) => s.category === category);
}

export const CATEGORIES = ["search", "text", "code", "data", "media", "util"] as const;
export type Category = (typeof CATEGORIES)[number];
