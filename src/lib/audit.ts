import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Log an audit event. Uses service_role client (bypasses RLS).
 * Fire-and-forget — errors are logged but don't break the caller.
 */
export async function logAuditEvent(params: {
  orgId: string | null;
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("audit_log").insert({
      org_id: params.orgId,
      actor_id: params.actorId,
      action: params.action,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
      metadata: params.metadata ?? {},
      ip_address: params.ipAddress ?? null,
    });
  } catch (err) {
    console.error("[audit] Failed to log event:", err);
  }
}

/**
 * Extract client IP from request headers (Vercel-compatible).
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded
    ? forwarded.split(",").pop()!.trim()
    : request.headers.get("x-real-ip") || "unknown";
}
