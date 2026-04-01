import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth";
import { verifyArenaAdminAuth } from "@/lib/arena/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientIp, logAuditEvent } from "@/lib/audit";
import {
  acknowledgeRollbackIncident,
  processRollbackForAgent,
  resolveRollbackIncident,
  upsertRollbackPolicy,
  type RollbackMode,
} from "@/lib/arena/rollback-guardrail";

const metricsSchema = z.object({
  sample_size: z.coerce.number().int().min(1),
  error_rate: z.coerce.number().min(0).max(1),
  avg_latency_ms: z.coerce.number().int().min(0),
  success_rate: z.coerce.number().min(0).max(1),
  trust_score: z.coerce.number().min(0).max(1),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("simulate"),
    metrics: metricsSchema,
    source: z.string().min(2).max(80).optional(),
  }),
  z.object({
    action: z.literal("trigger"),
    metrics: metricsSchema,
    source: z.string().min(2).max(80).optional(),
  }),
  z.object({
    action: z.literal("acknowledge"),
    incident_id: z.string().uuid(),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("resolve"),
    incident_id: z.string().uuid(),
    note: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("policy"),
    enabled: z.coerce.boolean().optional(),
    mode: z.enum(["dry_run", "active"]).optional(),
    min_sample_size: z.coerce.number().int().min(1).optional(),
    max_error_rate: z.coerce.number().min(0).max(1).optional(),
    max_latency_ms: z.coerce.number().int().min(1).optional(),
    min_success_rate: z.coerce.number().min(0).max(1).optional(),
    min_trust_score: z.coerce.number().min(0).max(1).optional(),
    cooldown_minutes: z.coerce.number().int().min(1).optional(),
  }),
]);

async function getOperator(request: NextRequest): Promise<{ profileId: string | null; via: "admin_secret" | "session" } | null> {
  const isServiceRole = await verifyArenaAdminAuth(request);
  if (isServiceRole) {
    return { profileId: null, via: "admin_secret" };
  }

  const auth = await getAuthContext(request);
  if (!auth?.profileId) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", auth.profileId)
    .single();

  if (!profile?.is_admin) return null;
  return { profileId: auth.profileId, via: "session" };
}

async function parsePayload(request: NextRequest): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  const form = await request.formData();
  const action = String(form.get("action") ?? "");

  if (action === "simulate" || action === "trigger") {
    return {
      action,
      source: form.get("source") ? String(form.get("source")) : undefined,
      metrics: {
        sample_size: Number(form.get("sample_size") ?? 0),
        error_rate: Number(form.get("error_rate") ?? 0),
        avg_latency_ms: Number(form.get("avg_latency_ms") ?? 0),
        success_rate: Number(form.get("success_rate") ?? 0),
        trust_score: Number(form.get("trust_score") ?? 0),
      },
    };
  }

  if (action === "acknowledge" || action === "resolve") {
    return {
      action,
      incident_id: String(form.get("incident_id") ?? ""),
      note: form.get("note") ? String(form.get("note")) : undefined,
    };
  }

  if (action === "policy") {
    const enabledRaw = form.get("enabled");
    return {
      action,
      enabled: enabledRaw == null ? undefined : enabledRaw === "true" || enabledRaw === "on" || enabledRaw === "1",
      mode: form.get("mode") ? String(form.get("mode")) : undefined,
      min_sample_size: form.get("min_sample_size") ? Number(form.get("min_sample_size")) : undefined,
      max_error_rate: form.get("max_error_rate") ? Number(form.get("max_error_rate")) : undefined,
      max_latency_ms: form.get("max_latency_ms") ? Number(form.get("max_latency_ms")) : undefined,
      min_success_rate: form.get("min_success_rate") ? Number(form.get("min_success_rate")) : undefined,
      min_trust_score: form.get("min_trust_score") ? Number(form.get("min_trust_score")) : undefined,
      cooldown_minutes: form.get("cooldown_minutes") ? Number(form.get("cooldown_minutes")) : undefined,
    };
  }

  return { action };
}

function isFormRequest(request: NextRequest): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const operator = await getOperator(request);
  if (!operator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { slug } = await params;
  const admin = createAdminClient();

  const { data: agent } = await admin
    .from("agents")
    .select("id, slug, name, status, health_status, health_score, model_id")
    .eq("slug", slug)
    .single();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const [policyResult, incidentsResult, snapshotsResult] = await Promise.all([
    admin
      .from("agent_rollback_policies")
      .select("enabled, mode, min_sample_size, max_error_rate, max_latency_ms, min_success_rate, min_trust_score, cooldown_minutes, updated_at")
      .eq("agent_id", agent.id)
      .maybeSingle(),
    admin
      .from("agent_rollback_incidents")
      .select("id, status, trigger_mode, rollback_mode, rollback_executed, source, reason, violations, cooldown_until, created_at, resolved_at")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(25),
    admin
      .from("agent_config_snapshots")
      .select("id, source, is_known_good, model_id, created_at")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  return NextResponse.json({
    agent,
    policy: policyResult.data,
    incidents: incidentsResult.data ?? [],
    snapshots: snapshotsResult.data ?? [],
    operator: operator.via,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const operator = await getOperator(request);
  if (!operator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await parsePayload(request);
  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { slug } = await params;
  const admin = createAdminClient();

  const { data: agent } = await admin
    .from("agents")
    .select("id")
    .eq("slug", slug)
    .single();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const formRequest = isFormRequest(request);

  if (parsed.data.action === "simulate" || parsed.data.action === "trigger") {
    const result = await processRollbackForAgent({
      agentSlug: slug,
      metrics: parsed.data.metrics,
      source: parsed.data.source ?? `operator:${operator.via}`,
      triggerMode: parsed.data.action === "simulate" ? "simulate" : "manual",
      simulateOnly: parsed.data.action === "simulate",
      actorId: operator.profileId,
    });

    if (operator.profileId) {
      await logAuditEvent({
        orgId: null,
        actorId: operator.profileId,
        action: `rollback.${parsed.data.action}`,
        targetType: "agent",
        targetId: agent.id as string,
        metadata: {
          slug,
          source: parsed.data.source ?? `operator:${operator.via}`,
          result,
        },
        ipAddress: getClientIp(request),
      });
    }

    if (formRequest) {
      return NextResponse.redirect(new URL(`/admin/rollback?agent=${encodeURIComponent(slug)}`, request.url), { status: 303 });
    }

    return NextResponse.json({ result });
  }

  if (parsed.data.action === "acknowledge") {
    const ok = await acknowledgeRollbackIncident({
      incidentId: parsed.data.incident_id,
      actorId: operator.profileId,
      note: parsed.data.note,
    });

    if (!ok) {
      return NextResponse.json({ error: "Unable to acknowledge incident" }, { status: 409 });
    }

    if (formRequest) {
      return NextResponse.redirect(new URL(`/admin/rollback?agent=${encodeURIComponent(slug)}`, request.url), { status: 303 });
    }

    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "resolve") {
    const ok = await resolveRollbackIncident({
      incidentId: parsed.data.incident_id,
      actorId: operator.profileId,
      note: parsed.data.note,
    });

    if (!ok) {
      return NextResponse.json({ error: "Unable to resolve incident" }, { status: 409 });
    }

    if (formRequest) {
      return NextResponse.redirect(new URL(`/admin/rollback?agent=${encodeURIComponent(slug)}`, request.url), { status: 303 });
    }

    return NextResponse.json({ ok: true });
  }

  await upsertRollbackPolicy({
    agentId: agent.id as string,
    actorId: operator.profileId,
    policy: {
      enabled: parsed.data.enabled,
      mode: parsed.data.mode as RollbackMode | undefined,
      minSampleSize: parsed.data.min_sample_size,
      maxErrorRate: parsed.data.max_error_rate,
      maxLatencyMs: parsed.data.max_latency_ms,
      minSuccessRate: parsed.data.min_success_rate,
      minTrustScore: parsed.data.min_trust_score,
      cooldownMinutes: parsed.data.cooldown_minutes,
    },
  });

  if (operator.profileId) {
    await logAuditEvent({
      orgId: null,
      actorId: operator.profileId,
      action: "rollback.policy.update",
      targetType: "agent",
      targetId: agent.id as string,
      metadata: {
        slug,
        policy: {
          enabled: parsed.data.enabled,
          mode: parsed.data.mode,
          min_sample_size: parsed.data.min_sample_size,
          max_error_rate: parsed.data.max_error_rate,
          max_latency_ms: parsed.data.max_latency_ms,
          min_success_rate: parsed.data.min_success_rate,
          min_trust_score: parsed.data.min_trust_score,
          cooldown_minutes: parsed.data.cooldown_minutes,
        },
      },
      ipAddress: getClientIp(request),
    });
  }

  if (formRequest) {
    return NextResponse.redirect(new URL(`/admin/rollback?agent=${encodeURIComponent(slug)}`, request.url), { status: 303 });
  }

  return NextResponse.json({ ok: true });
}
