import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/logger";

const notifyLog = log.scope("notifications");

/**
 * Create a notification for a user.
 * Messages should be plain English — never include technical details,
 * key values, or internal identifiers.
 */
export async function notify(
  admin: SupabaseClient,
  ownerId: string,
  type: "rotation_due" | "rotation_complete" | "breach_alert" | "rotation_failed" | "info",
  title: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const { error } = await admin.from("notifications").insert({
    owner_id: ownerId,
    type,
    title,
    message,
    metadata: metadata ?? {},
  });

  if (error) {
    notifyLog.error("notification_create_failed", { err: error, ownerId, type });
  }
}
