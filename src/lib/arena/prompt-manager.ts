// Prompt Version Manager — CRUD for hot-swappable agent system prompts.
// Used by the AutoTune loop to create, activate, and revert prompt versions.

import { createAdminClient } from "@/lib/supabase/admin";

export interface PromptVersion {
  id: string;
  agent_id: string;
  capability: string;
  version: number;
  system_prompt: string;
  model: string;
  max_tokens: number;
  temperature: number;
  is_active: boolean;
  elo_at_creation: number | null;
  created_at: string;
}

export interface CreatePromptVersionInput {
  agent_id: string;
  capability: string;
  system_prompt: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  elo_at_creation?: number;
}

/**
 * Get the currently active prompt version for an agent+capability.
 * Returns null if no active version exists (agent should use hardcoded default).
 */
export async function getActivePromptVersion(
  agentId: string,
  capability: string
): Promise<PromptVersion | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("prompt_versions")
    .select("*")
    .eq("agent_id", agentId)
    .eq("capability", capability)
    .eq("is_active", true)
    .single();

  if (error || !data) return null;
  return data as PromptVersion;
}

/**
 * Create a new prompt version. Auto-increments the version number.
 * Does NOT activate — call activatePromptVersion() separately.
 */
export async function createPromptVersion(
  input: CreatePromptVersionInput
): Promise<PromptVersion> {
  const admin = createAdminClient();

  // Get the next version number
  const { data: latest } = await admin
    .from("prompt_versions")
    .select("version")
    .eq("agent_id", input.agent_id)
    .eq("capability", input.capability)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  const nextVersion = (latest?.version ?? 0) + 1;

  const { data, error } = await admin
    .from("prompt_versions")
    .insert({
      agent_id: input.agent_id,
      capability: input.capability,
      version: nextVersion,
      system_prompt: input.system_prompt,
      model: input.model ?? "claude-haiku-4-5-20251001",
      max_tokens: input.max_tokens ?? 512,
      temperature: input.temperature ?? 0,
      is_active: false,
      elo_at_creation: input.elo_at_creation ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create prompt version: ${error?.message}`);
  }

  return data as PromptVersion;
}

/**
 * Activate a prompt version (atomic swap).
 * Deactivates any currently active version for the same agent+capability,
 * then activates the specified version.
 */
export async function activatePromptVersion(versionId: string): Promise<void> {
  const admin = createAdminClient();

  // Fetch the version to get agent_id and capability
  const { data: version, error: fetchError } = await admin
    .from("prompt_versions")
    .select("agent_id, capability")
    .eq("id", versionId)
    .single();

  if (fetchError || !version) {
    throw new Error(`Prompt version ${versionId} not found`);
  }

  // Deactivate all versions for this agent+capability
  await admin
    .from("prompt_versions")
    .update({ is_active: false })
    .eq("agent_id", version.agent_id)
    .eq("capability", version.capability)
    .eq("is_active", true);

  // Activate the target version
  const { error } = await admin
    .from("prompt_versions")
    .update({ is_active: true })
    .eq("id", versionId);

  if (error) {
    throw new Error(`Failed to activate version: ${error.message}`);
  }
}

/**
 * Revert to a specific prompt version.
 * Convenience wrapper around activatePromptVersion.
 */
export async function revertToVersion(versionId: string): Promise<void> {
  return activatePromptVersion(versionId);
}

/**
 * Get version history for an agent+capability (most recent first).
 */
export async function getVersionHistory(
  agentId: string,
  capability: string,
  limit = 20
): Promise<PromptVersion[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("prompt_versions")
    .select("*")
    .eq("agent_id", agentId)
    .eq("capability", capability)
    .order("version", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch version history: ${error.message}`);
  }

  return (data ?? []) as PromptVersion[];
}
