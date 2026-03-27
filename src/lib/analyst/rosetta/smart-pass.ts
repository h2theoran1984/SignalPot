/**
 * Smart Pass — uses Claude to match names that algorithmic methods couldn't resolve.
 * Sends unresolved names + existing taxonomy context to the LLM for semantic matching.
 */

import Anthropic from "@anthropic-ai/sdk";

interface TaxonomyContext {
  entityId: string;
  canonicalName: string;
  aliases: string[];
}

interface SmartMatch {
  input: string;
  entityId: string | null;
  canonicalName: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  isNewEntity: boolean;
  suggestedCanonical?: string;
}

const SYSTEM_PROMPT = `You are an entity resolution expert working with a canonical taxonomy of named entities (organizations, locations, systems, etc.).

You will receive:
1. A list of UNRESOLVED names that algorithmic matching couldn't confidently match
2. The EXISTING TAXONOMY of canonical entities with their known aliases

Your job:
- Match unresolved names to existing canonical entities where you're confident they're the same entity
- Identify names that represent NEW entities not yet in the taxonomy
- Consider: abbreviations, spelling variants, location suffixes, parent organizations, acronyms, "&" vs "and", common industry shorthand
- Be CONSERVATIVE — only match when genuinely confident

Respond with valid JSON only — no markdown fences.`;

export async function runSmartPass(
  apiKey: string,
  unresolved: string[],
  taxonomy: TaxonomyContext[],
): Promise<{
  matches: SmartMatch[];
  inputTokens: number;
  outputTokens: number;
}> {
  if (!unresolved.length) {
    return { matches: [], inputTokens: 0, outputTokens: 0 };
  }

  const client = new Anthropic({ apiKey });

  // Limit taxonomy context to prevent token explosion
  const taxonomySlice = taxonomy.slice(0, 50).map(t => ({
    entity_id: t.entityId,
    canonical: t.canonicalName,
    aliases: t.aliases.slice(0, 5),
  }));

  const prompt = `EXISTING TAXONOMY (${taxonomy.length} entities, showing first ${taxonomySlice.length}):

${JSON.stringify(taxonomySlice, null, 2)}

UNRESOLVED NAMES (${unresolved.length}):

${JSON.stringify(unresolved.map((name, i) => ({ index: i, name })), null, 2)}

For each unresolved name, determine if it matches an existing entity or is a new entity.

Return JSON:
{
  "matches": [
    {
      "index": 0,
      "entity_id": "uuid-here-or-null",
      "canonical_name": "matched canonical name or null",
      "confidence": "high|medium|low",
      "reason": "brief explanation",
      "is_new_entity": false,
      "suggested_canonical": "only if is_new_entity is true"
    }
  ]
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  let parsed: { matches: Array<{
    index: number;
    entity_id: string | null;
    canonical_name: string | null;
    confidence: "high" | "medium" | "low";
    reason: string;
    is_new_entity: boolean;
    suggested_canonical?: string;
  }> };

  try {
    let text = response.content[0].type === "text" ? response.content[0].text : "";
    if (text.startsWith("```")) {
      text = text.split("\n").slice(1).join("\n").replace(/```$/, "");
    }
    parsed = JSON.parse(text);
  } catch {
    // If parsing fails, return all as unmatched
    return {
      matches: unresolved.map(input => ({
        input,
        entityId: null,
        canonicalName: null,
        confidence: "low" as const,
        reason: "LLM response parsing failed",
        isNewEntity: false,
      })),
      inputTokens,
      outputTokens,
    };
  }

  const matches: SmartMatch[] = parsed.matches.map(m => ({
    input: unresolved[m.index] ?? "",
    entityId: m.entity_id,
    canonicalName: m.canonical_name,
    confidence: m.confidence,
    reason: m.reason,
    isNewEntity: m.is_new_entity,
    suggestedCanonical: m.suggested_canonical,
  }));

  return { matches, inputTokens, outputTokens };
}
