// Telemetry beacon — fire-and-forget internal helper.
// Inserts a row into agent_telemetry for rollup processing.
// Non-blocking: failures are logged but never throw.

import { createAdminClient } from "@/lib/supabase/admin";

interface BeaconEvent {
  agentId: string;
  profileId?: string | null;
  event?: "call_completed" | "call_failed" | "call_started";
  capability?: string | null;
  durationMs?: number | null;
  apiCost?: number | null;
  cost?: number | null;
  success?: boolean;
  caller?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Record an agent telemetry event. Fire-and-forget — does not block
 * the caller and swallows all errors silently.
 */
export function trackAgentCall(event: BeaconEvent): void {
  // Run async but don't await — true fire-and-forget
  void (async () => {
    try {
      const admin = createAdminClient();
      await admin.from("agent_telemetry").insert({
        agent_id: event.agentId,
        profile_id: event.profileId ?? "00000000-0000-0000-0000-000000000000",
        event: event.event ?? "call_completed",
        capability: event.capability ?? null,
        duration_ms: event.durationMs != null ? Math.round(event.durationMs) : null,
        api_cost: event.apiCost ?? 0,
        cost: event.cost ?? 0,
        success: event.success !== false,
        caller: event.caller ?? "platform",
        metadata: event.metadata ?? {},
      });
    } catch (err) {
      // Swallow — telemetry should never break the main flow
      console.error("[telemetry] beacon failed:", err instanceof Error ? err.message : err);
    }
  })();
}
