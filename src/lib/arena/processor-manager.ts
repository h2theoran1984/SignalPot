// Processor Manager — CRUD for agent_processors table.
// Tracks which processors are active per agent+capability.
// Mirrors the prompt-manager.ts pattern.

import { createAdminClient } from "@/lib/supabase/admin";
import { PROCESSOR_REGISTRY, type ArenaProcessor } from "./processors";

/**
 * Get the list of active processor IDs for an agent+capability.
 * Returns an empty array if no processors are active.
 */
export async function getActiveProcessors(
  agentId: string,
  capability: string,
): Promise<string[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("agent_processors")
    .select("processor_id")
    .eq("agent_id", agentId)
    .eq("capability", capability)
    .eq("is_active", true);

  if (error || !data) return [];
  return data.map((row) => row.processor_id as string);
}

/**
 * Look up a processor by ID from the in-code registry.
 * Returns null if the processor doesn't exist.
 */
export function getProcessorById(processorId: string): ArenaProcessor | null {
  return PROCESSOR_REGISTRY.find((p) => p.id === processorId) ?? null;
}

/**
 * Activate a processor for an agent+capability.
 * If already active, this is a no-op (unique index prevents duplicates).
 */
export async function activateProcessor(params: {
  agentId: string;
  capability: string;
  processorId: string;
  activatedBy: "manual" | "autotune";
  autotuneRunId?: string;
  eloAtActivation?: number;
}): Promise<void> {
  const { agentId, capability, processorId, activatedBy, autotuneRunId, eloAtActivation } = params;

  // Verify the processor exists in the registry
  const proc = getProcessorById(processorId);
  if (!proc) {
    throw new Error(`Unknown processor: ${processorId}`);
  }

  const admin = createAdminClient();

  // Upsert — if already active, do nothing
  const { error } = await admin
    .from("agent_processors")
    .upsert(
      {
        agent_id: agentId,
        capability,
        processor_id: processorId,
        is_active: true,
        activated_by: activatedBy,
        autotune_run_id: autotuneRunId ?? null,
        elo_at_activation: eloAtActivation ?? null,
      },
      { onConflict: "agent_id,capability,processor_id" }
    );

  if (error) {
    // If it's a unique constraint violation, the processor is already active — that's fine
    if (error.code === "23505") return;
    throw new Error(`Failed to activate processor: ${error.message}`);
  }
}

/**
 * Deactivate a processor for an agent+capability.
 */
export async function deactivateProcessor(
  agentId: string,
  capability: string,
  processorId: string,
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("agent_processors")
    .update({ is_active: false })
    .eq("agent_id", agentId)
    .eq("capability", capability)
    .eq("processor_id", processorId)
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to deactivate processor: ${error.message}`);
  }
}
