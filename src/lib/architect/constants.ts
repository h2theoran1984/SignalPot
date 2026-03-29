/**
 * Constants, model configs, and few-shot examples for The Architect.
 */

export const ARCHITECT_MODEL = "claude-sonnet-4-6";

export const AVAILABLE_MODELS: Record<string, { id: string; costPerCall: number }> = {
  haiku: { id: "claude-haiku-4-5-20251001", costPerCall: 0.001 },
  sonnet: { id: "claude-sonnet-4-6", costPerCall: 0.01 },
  opus: { id: "claude-opus-4-6", costPerCall: 0.05 },
};

export const DEFAULT_MODEL = "haiku";

/** Reserved slugs that Architect-generated agents cannot use. */
export const RESERVED_SLUGS = [
  "sparring-partner",
  "the-goliath",
  "the-underdog",
  "the-architect",
];

/** Few-shot examples of capability schemas for schema generation. */
export const CAPABILITY_EXAMPLES = [
  {
    description: "A market analysis agent that analyzes competitive share data",
    schema: {
      name: "analyze",
      description: "Competitive market analysis with share shifts and recommendations",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string", description: "Product category to analyze" },
          brands: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                revenue: { type: "number" },
                units: { type: "number" },
                share_pct: { type: "number" },
                share_change_pp: { type: "number" },
              },
            },
          },
          time_period: { type: "string" },
          contextual_notes: { type: "string" },
        },
        required: ["category", "brands"],
      },
      outputSchema: {
        type: "object",
        properties: {
          category_health: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["growing", "stable", "declining", "mixed"] },
              summary: { type: "string" },
            },
          },
          winners: {
            type: "array",
            items: {
              type: "object",
              properties: {
                brand: { type: "string" },
                share_change_pp: { type: "number" },
                driver: { type: "string" },
              },
            },
          },
          losers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                brand: { type: "string" },
                share_change_pp: { type: "number" },
                driver: { type: "string" },
              },
            },
          },
          recommendations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                action: { type: "string" },
                rationale: { type: "string" },
                priority: { type: "string", enum: ["immediate", "short_term", "monitor"] },
              },
            },
          },
        },
      },
    },
  },
  {
    description: "A pricing monitor that flags competitor price drops",
    schema: {
      name: "price_watch",
      description: "Monitor pricing data and flag significant competitive price changes",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string" },
          products: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                current_price: { type: "number" },
                previous_price: { type: "number" },
                retailer: { type: "string" },
              },
            },
          },
          threshold_pct: { type: "number", description: "Minimum % change to flag" },
        },
        required: ["category", "products"],
      },
      outputSchema: {
        type: "object",
        properties: {
          alerts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                product: { type: "string" },
                change_pct: { type: "number" },
                direction: { type: "string", enum: ["drop", "increase"] },
                impact: { type: "string" },
                recommended_response: { type: "string" },
              },
            },
          },
          summary: { type: "string" },
          risk_level: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
  },
];

/** System prompt template for The Architect's own reasoning. */
export const ARCHITECT_SYSTEM = `You are The Architect, a meta-agent on the SignalPot platform that creates other agents.

You take natural language descriptions of what an agent should do and produce:
1. A structured intent (domain, capability type, inputs/outputs needed)
2. A JSON Schema capability definition (inputSchema + outputSchema)
3. A domain-tuned system prompt that makes the agent an expert

You follow these rules:
- Generated agents respond with structured JSON matching their outputSchema
- System prompts include domain expertise, output format instructions, and guardrails
- Capability schemas use standard JSON Schema (type, properties, required, enum, items, description)
- Keep schemas practical — include the fields needed for the domain, not every possible field
- System prompts should make the agent sound like a domain expert with years of experience
- Always include guardrails: stay in domain, admit uncertainty, structured output only`;
