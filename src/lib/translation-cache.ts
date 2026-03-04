/**
 * Translation cache for schema pair mappings — Sprint 12 stub.
 *
 * Caches AI-generated schema translation functions to avoid
 * repeated LLM calls for the same schema pair.
 *
 * Storage: Supabase table (future) or Upstash Redis (future).
 * Currently an in-memory map for development only.
 */

import type { SchemaTranslation } from "./schema-translator";

// In-memory cache for development — does not persist across requests
const memoryCache = new Map<string, SchemaTranslation>();

function cacheKey(
  sourceSchema: Record<string, unknown>,
  targetSchema: Record<string, unknown>
): string {
  return `${JSON.stringify(sourceSchema)}::${JSON.stringify(targetSchema)}`;
}

export async function getCachedTranslation(
  sourceSchema: Record<string, unknown>,
  targetSchema: Record<string, unknown>
): Promise<SchemaTranslation | null> {
  const key = cacheKey(sourceSchema, targetSchema);
  return memoryCache.get(key) ?? null;
}

export async function cacheTranslation(
  sourceSchema: Record<string, unknown>,
  targetSchema: Record<string, unknown>,
  translation: SchemaTranslation
): Promise<void> {
  const key = cacheKey(sourceSchema, targetSchema);
  memoryCache.set(key, translation);
  // TODO: Persist to Supabase or Upstash Redis
}

export async function invalidateTranslation(
  sourceSchema: Record<string, unknown>,
  targetSchema: Record<string, unknown>
): Promise<void> {
  const key = cacheKey(sourceSchema, targetSchema);
  memoryCache.delete(key);
}
