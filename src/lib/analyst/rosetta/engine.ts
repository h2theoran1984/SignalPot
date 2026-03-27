/**
 * Rosetta v2 Engine — orchestrates the full normalization pipeline.
 *
 * Pipeline: Load taxonomy -> Fast pass (algorithmic) -> Smart pass (LLM) -> Save results
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { runFastPass, type FastPassResult } from "./fast-pass.js";
import { runSmartPass } from "./smart-pass.js";

export interface ResolveResult {
  resolved: Array<{
    input: string;
    entityId: string;
    canonicalName: string;
    confidence: "high" | "medium" | "low";
    method: string;
  }>;
  unresolved: string[];
  newEntities: Array<{
    input: string;
    suggestedCanonical: string;
    confidence: "high" | "medium" | "low";
    reason: string;
  }>;
  stats: {
    total: number;
    resolved: number;
    unresolved: number;
    newEntities: number;
    fastPassResolved: number;
    smartPassResolved: number;
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Resolve a batch of names against the taxonomy for a given dimension.
 * Runs fast-pass first, then smart-pass on remaining unresolved names.
 */
export async function resolveNames(
  admin: SupabaseClient,
  ownerId: string,
  dimensionId: string,
  inputs: string[],
  options: {
    apiKey?: string;
    skipSmartPass?: boolean;
  } = {}
): Promise<ResolveResult> {
  // 1. Fast pass
  const fastResults = await runFastPass(admin, ownerId, dimensionId, inputs);

  const resolved: ResolveResult["resolved"] = [];
  const needsSmartPass: string[] = [];

  let fastPassResolved = 0;

  for (const result of fastResults) {
    if (result.match) {
      resolved.push({
        input: result.input,
        entityId: result.match.entityId,
        canonicalName: result.match.canonicalName,
        confidence: result.match.confidence,
        method: result.match.method,
      });
      fastPassResolved++;
    } else {
      needsSmartPass.push(result.input);
    }
  }

  // 2. Smart pass (if API key available and not skipped)
  let smartPassResolved = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const newEntities: ResolveResult["newEntities"] = [];
  let stillUnresolved = needsSmartPass;

  if (options.apiKey && !options.skipSmartPass && needsSmartPass.length > 0) {
    // Load taxonomy context for the LLM
    const { data: entities } = await admin
      .from("analyst_entities")
      .select("id, canonical_name")
      .eq("dimension_id", dimensionId)
      .eq("owner_id", ownerId);

    const entityIds = (entities ?? []).map(e => e.id);

    // Batch fetch aliases for all entities
    const { data: aliases } = entityIds.length > 0
      ? await admin
          .from("analyst_aliases")
          .select("entity_id, alias")
          .in("entity_id", entityIds)
      : { data: [] };

    const aliasMap = new Map<string, string[]>();
    for (const a of aliases ?? []) {
      const arr = aliasMap.get(a.entity_id) ?? [];
      arr.push(a.alias);
      aliasMap.set(a.entity_id, arr);
    }

    const taxonomyContext = (entities ?? []).map(e => ({
      entityId: e.id,
      canonicalName: e.canonical_name,
      aliases: aliasMap.get(e.id) ?? [],
    }));

    const smartResult = await runSmartPass(options.apiKey, needsSmartPass, taxonomyContext);
    inputTokens = smartResult.inputTokens;
    outputTokens = smartResult.outputTokens;

    stillUnresolved = [];

    for (const match of smartResult.matches) {
      if (match.entityId && match.confidence !== "low") {
        resolved.push({
          input: match.input,
          entityId: match.entityId,
          canonicalName: match.canonicalName ?? "",
          confidence: match.confidence,
          method: "smart_pass",
        });
        smartPassResolved++;
      } else if (match.isNewEntity && match.suggestedCanonical) {
        newEntities.push({
          input: match.input,
          suggestedCanonical: match.suggestedCanonical,
          confidence: match.confidence,
          reason: match.reason,
        });
      } else {
        stillUnresolved.push(match.input);
      }
    }
  }

  return {
    resolved,
    unresolved: stillUnresolved,
    newEntities,
    stats: {
      total: inputs.length,
      resolved: resolved.length,
      unresolved: stillUnresolved.length,
      newEntities: newEntities.length,
      fastPassResolved,
      smartPassResolved,
      inputTokens,
      outputTokens,
    },
  };
}

/**
 * Save a resolved alias to the taxonomy for future matching.
 */
export async function learnAlias(
  admin: SupabaseClient,
  entityId: string,
  alias: string,
  sourceId: string | null,
  matchedBy: string = "user"
): Promise<boolean> {
  const { error } = await admin
    .from("analyst_aliases")
    .upsert(
      {
        entity_id: entityId,
        alias,
        source_id: sourceId,
        confidence: matchedBy === "user" ? "manual" : matchedBy === "smart_pass" ? "medium" : "high",
        matched_by: matchedBy,
      },
      { onConflict: "entity_id,alias,source_id" }
    );

  return !error;
}

/**
 * Create a new canonical entity and optionally save its first alias.
 */
export async function createEntity(
  admin: SupabaseClient,
  ownerId: string,
  dimensionId: string,
  canonicalName: string,
  alias?: string,
  sourceId?: string
): Promise<{ entityId: string } | null> {
  const { data, error } = await admin
    .from("analyst_entities")
    .insert({
      owner_id: ownerId,
      dimension_id: dimensionId,
      canonical_name: canonicalName,
    })
    .select("id")
    .single();

  if (error || !data) return null;

  // Save the canonical name itself as an alias
  await learnAlias(admin, data.id, canonicalName, null, "user");

  // Save the provided alias if different from canonical
  if (alias && alias !== canonicalName) {
    await learnAlias(admin, data.id, alias, sourceId ?? null, "user");
  }

  return { entityId: data.id };
}
