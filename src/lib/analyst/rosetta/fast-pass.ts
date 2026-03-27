/**
 * Fast Pass — matches input names against the canonical taxonomy using
 * exact match, normalized match, base name match, and fuzzy matching.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { normalize, extractBaseName, tokenize, tokenSimilarity, editSimilarity } from "./normalize.js";

export interface MatchCandidate {
  entityId: string;
  canonicalName: string;
  dimensionId: string;
  score: number;
  method: "exact_alias" | "exact_normalized" | "base_name" | "fuzzy";
  confidence: "high" | "medium" | "low";
}

export interface FastPassResult {
  input: string;
  match: MatchCandidate | null;
  candidates: MatchCandidate[];
}

interface AliasRow {
  alias: string;
  entity_id: string;
  analyst_entities: {
    id: string;
    canonical_name: string;
    dimension_id: string;
  };
}

interface EntityRow {
  id: string;
  canonical_name: string;
  dimension_id: string;
}

/**
 * Load all aliases and entities for a given owner and dimension.
 * Caches in memory for the duration of a batch operation.
 */
async function loadTaxonomy(
  admin: SupabaseClient,
  ownerId: string,
  dimensionId: string
): Promise<{ aliases: AliasRow[]; entities: EntityRow[] }> {
  const [aliasResult, entityResult] = await Promise.all([
    admin
      .from("analyst_aliases")
      .select("alias, entity_id, analyst_entities!inner(id, canonical_name, dimension_id)")
      .eq("analyst_entities.dimension_id", dimensionId)
      .eq("analyst_entities.owner_id", ownerId),
    admin
      .from("analyst_entities")
      .select("id, canonical_name, dimension_id")
      .eq("dimension_id", dimensionId)
      .eq("owner_id", ownerId),
  ]);

  return {
    aliases: (aliasResult.data ?? []) as unknown as AliasRow[],
    entities: (entityResult.data ?? []) as unknown as EntityRow[],
  };
}

/**
 * Build lookup structures from taxonomy data.
 */
function buildIndex(aliases: AliasRow[], entities: EntityRow[]) {
  // Exact alias lookup (lowercased)
  const aliasMap = new Map<string, AliasRow>();
  for (const a of aliases) {
    aliasMap.set(a.alias.toLowerCase(), a);
  }

  // Normalized canonical name lookup
  const normalizedMap = new Map<string, EntityRow>();
  for (const e of entities) {
    normalizedMap.set(normalize(e.canonical_name), e);
  }

  // Base name lookup
  const baseNameMap = new Map<string, EntityRow>();
  for (const e of entities) {
    baseNameMap.set(normalize(extractBaseName(e.canonical_name)), e);
  }

  // Token sets for fuzzy matching
  const entityTokens = entities.map(e => ({
    entity: e,
    tokens: tokenize(e.canonical_name),
    normalized: normalize(e.canonical_name),
  }));

  return { aliasMap, normalizedMap, baseNameMap, entityTokens };
}

/**
 * Match a single input name against the taxonomy.
 */
function matchOne(
  input: string,
  index: ReturnType<typeof buildIndex>
): FastPassResult {
  const candidates: MatchCandidate[] = [];

  // 1. Exact alias match
  const aliasHit = index.aliasMap.get(input.toLowerCase());
  if (aliasHit) {
    const entity = aliasHit.analyst_entities;
    return {
      input,
      match: {
        entityId: entity.id,
        canonicalName: entity.canonical_name,
        dimensionId: entity.dimension_id,
        score: 100,
        method: "exact_alias",
        confidence: "high",
      },
      candidates: [],
    };
  }

  // 2. Exact normalized match against canonical names
  const normed = normalize(input);
  const normalizedHit = index.normalizedMap.get(normed);
  if (normalizedHit) {
    return {
      input,
      match: {
        entityId: normalizedHit.id,
        canonicalName: normalizedHit.canonical_name,
        dimensionId: normalizedHit.dimension_id,
        score: 95,
        method: "exact_normalized",
        confidence: "high",
      },
      candidates: [],
    };
  }

  // 3. Base name match
  const baseName = normalize(extractBaseName(input));
  const baseHit = index.baseNameMap.get(baseName);
  if (baseHit) {
    candidates.push({
      entityId: baseHit.id,
      canonicalName: baseHit.canonical_name,
      dimensionId: baseHit.dimension_id,
      score: 85,
      method: "base_name",
      confidence: "high",
    });
  }

  // 4. Fuzzy matching — token similarity + edit distance
  const inputTokens = tokenize(input);
  for (const entry of index.entityTokens) {
    const tokenScore = tokenSimilarity(inputTokens, entry.tokens) * 100;
    const editScore = editSimilarity(normed, entry.normalized);
    const combined = Math.round(tokenScore * 0.4 + editScore * 0.6);

    if (combined >= 70) {
      candidates.push({
        entityId: entry.entity.id,
        canonicalName: entry.entity.canonical_name,
        dimensionId: entry.entity.dimension_id,
        score: combined,
        method: "fuzzy",
        confidence: combined >= 85 ? "medium" : "low",
      });
    }
  }

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Auto-match if top candidate is high confidence and well separated from #2
  const top = candidates[0] ?? null;
  const second = candidates[1] ?? null;

  let autoMatch: MatchCandidate | null = null;
  if (top && top.confidence === "high") {
    autoMatch = top;
  } else if (top && top.score >= 85 && (!second || top.score - second.score >= 10)) {
    autoMatch = top;
  }

  return {
    input,
    match: autoMatch,
    candidates: candidates.slice(0, 5),
  };
}

/**
 * Run fast-pass matching for a batch of input names against a dimension's taxonomy.
 */
export async function runFastPass(
  admin: SupabaseClient,
  ownerId: string,
  dimensionId: string,
  inputs: string[]
): Promise<FastPassResult[]> {
  const { aliases, entities } = await loadTaxonomy(admin, ownerId, dimensionId);
  const index = buildIndex(aliases, entities);
  return inputs.map(input => matchOne(input, index));
}
