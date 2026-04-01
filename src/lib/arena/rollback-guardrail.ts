import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type RollbackMode = "dry_run" | "active";

export interface RollbackPolicy {
  enabled: boolean;
  mode: RollbackMode;
  minSampleSize: number;
  maxErrorRate: number;
  maxLatencyMs: number;
  minSuccessRate: number;
  minTrustScore: number;
  cooldownMinutes: number;
}

export interface RollbackMetrics {
  sample_size: number;
  error_rate: number;
  avg_latency_ms: number;
  success_rate: number;
  trust_score: number;
}

export interface PolicyViolation {
  metric: "error_rate" | "avg_latency_ms" | "success_rate" | "trust_score";
  observed: number;
  threshold: number;
  direction: "above_max" | "below_min";
}

export interface RollbackDecision {
  shouldTrigger: boolean;
  blockedByCooldown: boolean;
  skippedBySampleSize: boolean;
  reasons: PolicyViolation[];
}

export interface RollbackProcessResult {
  ok: boolean;
  should_trigger: boolean;
  blocked_by_cooldown: boolean;
  skipped_by_sample_size: boolean;
  executed: boolean;
  dry_run: boolean;
  incident_id: string | null;
  target_snapshot_id: string | null;
  reasons: PolicyViolation[];
  message: string;
}

interface AgentRow {
  id: string;
  slug: string;
  name: string;
  model_id: string | null;
  system_prompt: string | null;
  architect_version: number | null;
  health_status: string | null;
  status: string;
}

interface SnapshotRow {
  id: string;
  model_id: string | null;
  system_prompt: string | null;
  architect_version: number | null;
  created_at: string;
}

const ENV = process.env;

function envNumber(name: string, fallback: number): number {
  const raw = ENV[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = ENV[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function envMode(name: string, fallback: RollbackMode): RollbackMode {
  const raw = ENV[name];
  if (!raw) return fallback;
  return raw === "active" ? "active" : "dry_run";
}

export function getDefaultRollbackPolicy(): RollbackPolicy {
  return {
    enabled: envBoolean("ROLLBACK_GUARDRAIL_ENABLED", true),
    mode: envMode("ROLLBACK_GUARDRAIL_MODE", "dry_run"),
    minSampleSize: envNumber("ROLLBACK_MIN_SAMPLE_SIZE", 20),
    maxErrorRate: envNumber("ROLLBACK_MAX_ERROR_RATE", 0.08),
    maxLatencyMs: envNumber("ROLLBACK_MAX_LATENCY_MS", 3000),
    minSuccessRate: envNumber("ROLLBACK_MIN_SUCCESS_RATE", 0.9),
    minTrustScore: envNumber("ROLLBACK_MIN_TRUST_SCORE", 0.55),
    cooldownMinutes: envNumber("ROLLBACK_COOLDOWN_MINUTES", 30),
  };
}

function normRate(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizeMetrics(metrics: RollbackMetrics): RollbackMetrics {
  return {
    sample_size: Math.max(0, Math.floor(metrics.sample_size)),
    error_rate: normRate(metrics.error_rate),
    avg_latency_ms: Math.max(0, Math.floor(metrics.avg_latency_ms)),
    success_rate: normRate(metrics.success_rate),
    trust_score: normRate(metrics.trust_score),
  };
}

export function evaluateRollbackDecision(params: {
  metrics: RollbackMetrics;
  policy: RollbackPolicy;
  inCooldown: boolean;
}): RollbackDecision {
  const metrics = normalizeMetrics(params.metrics);
  const policy = params.policy;

  if (!policy.enabled) {
    return {
      shouldTrigger: false,
      blockedByCooldown: false,
      skippedBySampleSize: true,
      reasons: [],
    };
  }

  if (metrics.sample_size < policy.minSampleSize) {
    return {
      shouldTrigger: false,
      blockedByCooldown: false,
      skippedBySampleSize: true,
      reasons: [],
    };
  }

  const reasons: PolicyViolation[] = [];

  if (metrics.error_rate > policy.maxErrorRate) {
    reasons.push({
      metric: "error_rate",
      observed: metrics.error_rate,
      threshold: policy.maxErrorRate,
      direction: "above_max",
    });
  }

  if (metrics.avg_latency_ms > policy.maxLatencyMs) {
    reasons.push({
      metric: "avg_latency_ms",
      observed: metrics.avg_latency_ms,
      threshold: policy.maxLatencyMs,
      direction: "above_max",
    });
  }

  if (metrics.success_rate < policy.minSuccessRate) {
    reasons.push({
      metric: "success_rate",
      observed: metrics.success_rate,
      threshold: policy.minSuccessRate,
      direction: "below_min",
    });
  }

  if (metrics.trust_score < policy.minTrustScore) {
    reasons.push({
      metric: "trust_score",
      observed: metrics.trust_score,
      threshold: policy.minTrustScore,
      direction: "below_min",
    });
  }

  const hasViolations = reasons.length > 0;
  const blockedByCooldown = hasViolations && params.inCooldown;

  return {
    shouldTrigger: hasViolations && !blockedByCooldown,
    blockedByCooldown,
    skippedBySampleSize: false,
    reasons,
  };
}

export async function getEffectiveRollbackPolicy(
  admin: SupabaseClient,
  agentId: string
): Promise<RollbackPolicy> {
  const defaults = getDefaultRollbackPolicy();

  const { data } = await admin
    .from("agent_rollback_policies")
    .select("enabled, mode, min_sample_size, max_error_rate, max_latency_ms, min_success_rate, min_trust_score, cooldown_minutes")
    .eq("agent_id", agentId)
    .maybeSingle();

  if (!data) return defaults;

  return {
    enabled: data.enabled ?? defaults.enabled,
    mode: (data.mode as RollbackMode | null) ?? defaults.mode,
    minSampleSize: Number(data.min_sample_size ?? defaults.minSampleSize),
    maxErrorRate: Number(data.max_error_rate ?? defaults.maxErrorRate),
    maxLatencyMs: Number(data.max_latency_ms ?? defaults.maxLatencyMs),
    minSuccessRate: Number(data.min_success_rate ?? defaults.minSuccessRate),
    minTrustScore: Number(data.min_trust_score ?? defaults.minTrustScore),
    cooldownMinutes: Number(data.cooldown_minutes ?? defaults.cooldownMinutes),
  };
}

async function getAgentBySlug(admin: SupabaseClient, slug: string): Promise<AgentRow | null> {
  const { data } = await admin
    .from("agents")
    .select("id, slug, name, model_id, system_prompt, architect_version, health_status, status")
    .eq("slug", slug)
    .single();

  return (data as AgentRow | null) ?? null;
}

async function hasActiveCooldown(admin: SupabaseClient, agentId: string, nowIso: string): Promise<boolean> {
  const { data } = await admin
    .from("agent_rollback_incidents")
    .select("id")
    .eq("agent_id", agentId)
    .gt("cooldown_until", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Boolean(data?.id);
}

async function createSnapshot(params: {
  admin: SupabaseClient;
  agent: AgentRow;
  source: string;
  knownGood: boolean;
  metrics: RollbackMetrics;
  createdBy: string | null;
}): Promise<string> {
  const { admin, agent, source, knownGood, metrics, createdBy } = params;

  const { data, error } = await admin
    .from("agent_config_snapshots")
    .insert({
      agent_id: agent.id,
      model_id: agent.model_id,
      system_prompt: agent.system_prompt,
      architect_version: agent.architect_version,
      source,
      is_known_good: knownGood,
      metrics_snapshot: metrics,
      created_by: createdBy,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create snapshot: ${error?.message ?? "unknown"}`);
  }

  return data.id as string;
}

async function maybeCaptureKnownGoodSnapshot(params: {
  admin: SupabaseClient;
  agent: AgentRow;
  metrics: RollbackMetrics;
  actorId: string | null;
}): Promise<string | null> {
  const { admin, agent, metrics, actorId } = params;

  const { data: latest } = await admin
    .from("agent_config_snapshots")
    .select("id, model_id, system_prompt")
    .eq("agent_id", agent.id)
    .eq("is_known_good", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const unchanged =
    latest &&
    latest.model_id === agent.model_id &&
    latest.system_prompt === agent.system_prompt;

  if (unchanged) return latest.id as string;

  return createSnapshot({
    admin,
    agent,
    source: "guardrail_known_good",
    knownGood: true,
    metrics,
    createdBy: actorId,
  });
}

async function selectRollbackTargetSnapshot(
  admin: SupabaseClient,
  agent: AgentRow
): Promise<SnapshotRow | null> {
  const { data } = await admin
    .from("agent_config_snapshots")
    .select("id, model_id, system_prompt, architect_version, created_at")
    .eq("agent_id", agent.id)
    .eq("is_known_good", true)
    .order("created_at", { ascending: false })
    .limit(20);

  const snapshots = (data ?? []) as SnapshotRow[];

  for (const s of snapshots) {
    if (s.model_id !== agent.model_id || s.system_prompt !== agent.system_prompt) {
      return s;
    }
  }

  return null;
}

async function applyRollback(
  admin: SupabaseClient,
  agent: AgentRow,
  target: SnapshotRow,
  freezeUntilIso: string
): Promise<void> {
  const { error } = await admin
    .from("agents")
    .update({
      model_id: target.model_id,
      system_prompt: target.system_prompt,
      architect_version: target.architect_version,
      health_status: "degrading",
      health_checked_at: new Date().toISOString(),
      traffic_mode: "frozen",
      canary_percent: 0,
      freeze_until: freezeUntilIso,
    })
    .eq("id", agent.id);

  if (error) {
    throw new Error(`Failed to apply rollback: ${error.message}`);
  }
}

function reasonsSummary(reasons: PolicyViolation[]): string {
  if (reasons.length === 0) return "No threshold violations";
  return reasons
    .map((r) => {
      const observed = r.metric === "avg_latency_ms"
        ? `${Math.round(r.observed)}ms`
        : `${(r.observed * 100).toFixed(1)}%`;
      const threshold = r.metric === "avg_latency_ms"
        ? `${Math.round(r.threshold)}ms`
        : `${(r.threshold * 100).toFixed(1)}%`;
      return `${r.metric} ${r.direction === "above_max" ? "above" : "below"} threshold (${observed} vs ${threshold})`;
    })
    .join(", ");
}

async function createIncident(params: {
  admin: SupabaseClient;
  agent: AgentRow;
  status: "open" | "simulated";
  triggerMode: "auto" | "manual" | "simulate";
  rollbackMode: RollbackMode;
  rollbackExecuted: boolean;
  source: string;
  metrics: RollbackMetrics;
  policy: RollbackPolicy;
  reasons: PolicyViolation[];
  fromSnapshotId: string | null;
  targetSnapshotId: string | null;
  cooldownUntilIso: string;
}): Promise<string> {
  const { data, error } = await params.admin
    .from("agent_rollback_incidents")
    .insert({
      agent_id: params.agent.id,
      status: params.status,
      trigger_mode: params.triggerMode,
      rollback_mode: params.rollbackMode,
      rollback_executed: params.rollbackExecuted,
      source: params.source,
      reason: reasonsSummary(params.reasons),
      violations: params.reasons,
      metrics_snapshot: params.metrics,
      policy_snapshot: {
        enabled: params.policy.enabled,
        mode: params.policy.mode,
        min_sample_size: params.policy.minSampleSize,
        max_error_rate: params.policy.maxErrorRate,
        max_latency_ms: params.policy.maxLatencyMs,
        min_success_rate: params.policy.minSuccessRate,
        min_trust_score: params.policy.minTrustScore,
        cooldown_minutes: params.policy.cooldownMinutes,
      },
      from_snapshot_id: params.fromSnapshotId,
      target_snapshot_id: params.targetSnapshotId,
      cooldown_until: params.cooldownUntilIso,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create rollback incident: ${error?.message ?? "unknown"}`);
  }

  return data.id as string;
}

export async function processRollbackForAgent(params: {
  agentSlug: string;
  metrics: RollbackMetrics;
  source: string;
  triggerMode: "auto" | "manual" | "simulate";
  simulateOnly?: boolean;
  actorId?: string | null;
}): Promise<RollbackProcessResult> {
  const admin = createAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const agent = await getAgentBySlug(admin, params.agentSlug);
  if (!agent || agent.status !== "active") {
    return {
      ok: false,
      should_trigger: false,
      blocked_by_cooldown: false,
      skipped_by_sample_size: false,
      executed: false,
      dry_run: true,
      incident_id: null,
      target_snapshot_id: null,
      reasons: [],
      message: `Agent '${params.agentSlug}' not found or inactive`,
    };
  }

  const policy = await getEffectiveRollbackPolicy(admin, agent.id);
  const inCooldown = await hasActiveCooldown(admin, agent.id, nowIso);
  const metrics = normalizeMetrics(params.metrics);
  const decision = evaluateRollbackDecision({ metrics, policy, inCooldown });

  if (!decision.shouldTrigger) {
    if (!decision.blockedByCooldown && !decision.skippedBySampleSize && decision.reasons.length === 0) {
      await maybeCaptureKnownGoodSnapshot({
        admin,
        agent,
        metrics,
        actorId: params.actorId ?? null,
      });
    }

    return {
      ok: true,
      should_trigger: false,
      blocked_by_cooldown: decision.blockedByCooldown,
      skipped_by_sample_size: decision.skippedBySampleSize,
      executed: false,
      dry_run: policy.mode === "dry_run" || Boolean(params.simulateOnly),
      incident_id: null,
      target_snapshot_id: null,
      reasons: decision.reasons,
      message: decision.blockedByCooldown
        ? "Guardrail violation detected but cooldown is active"
        : decision.skippedBySampleSize
          ? "Insufficient sample size for rollback evaluation"
          : "No rollback thresholds breached",
    };
  }

  const fromSnapshotId = await createSnapshot({
    admin,
    agent,
    source: `${params.source}_before`,
    knownGood: false,
    metrics,
    createdBy: params.actorId ?? null,
  });

  const target = await selectRollbackTargetSnapshot(admin, agent);
  const dryRun = policy.mode === "dry_run" || Boolean(params.simulateOnly) || !target;
  const cooldownUntil = new Date(now.getTime() + policy.cooldownMinutes * 60 * 1000).toISOString();

  if (!dryRun && target) {
    await applyRollback(admin, agent, target, cooldownUntil);

    await admin.from("agent_health_events").insert({
      agent_id: agent.id,
      event_type: "degradation",
      severity: "critical",
      message: `Auto-rollback applied for ${agent.slug}: ${reasonsSummary(decision.reasons)}`,
      metrics_snapshot: {
        metrics,
        reasons: decision.reasons,
        target_snapshot_id: target.id,
      },
    });
  }

  const incidentId = await createIncident({
    admin,
    agent,
    status: params.simulateOnly ? "simulated" : "open",
    triggerMode: params.triggerMode,
    rollbackMode: policy.mode,
    rollbackExecuted: !dryRun,
    source: params.source,
    metrics,
    policy,
    reasons: decision.reasons,
    fromSnapshotId,
    targetSnapshotId: target?.id ?? null,
    cooldownUntilIso: cooldownUntil,
  });

  return {
    ok: true,
    should_trigger: true,
    blocked_by_cooldown: false,
    skipped_by_sample_size: false,
    executed: !dryRun,
    dry_run: dryRun,
    incident_id: incidentId,
    target_snapshot_id: target?.id ?? null,
    reasons: decision.reasons,
    message: dryRun
      ? target
        ? "Rollback triggered in dry-run mode"
        : "Rollback triggered but no known-good snapshot available"
      : "Rollback applied successfully",
  };
}

export async function acknowledgeRollbackIncident(params: {
  incidentId: string;
  actorId: string | null;
  note?: string;
}): Promise<boolean> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("agent_rollback_incidents")
    .update({
      status: "acknowledged",
      acked_by: params.actorId,
      acked_at: new Date().toISOString(),
      resolution_notes: params.note ?? null,
    })
    .eq("id", params.incidentId)
    .in("status", ["open", "simulated"]);

  return !error;
}

export async function resolveRollbackIncident(params: {
  incidentId: string;
  actorId: string | null;
  note?: string;
}): Promise<boolean> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: incident } = await admin
    .from("agent_rollback_incidents")
    .select("agent_id")
    .eq("id", params.incidentId)
    .maybeSingle();

  const { error } = await admin
    .from("agent_rollback_incidents")
    .update({
      status: "resolved",
      resolved_by: params.actorId,
      resolved_at: nowIso,
      resolution_notes: params.note ?? null,
    })
    .eq("id", params.incidentId)
    .in("status", ["open", "acknowledged", "simulated"]);

  if (error || !incident?.agent_id) return false;

  await admin
    .from("agents")
    .update({
      traffic_mode: "canary",
      canary_percent: 20,
      freeze_until: null,
      health_checked_at: nowIso,
    })
    .eq("id", incident.agent_id);

  return true;
}

export async function upsertRollbackPolicy(params: {
  agentId: string;
  actorId: string | null;
  policy: Partial<RollbackPolicy>;
}): Promise<void> {
  const admin = createAdminClient();
  const current = await getEffectiveRollbackPolicy(admin, params.agentId);

  const next: RollbackPolicy = {
    enabled: params.policy.enabled ?? current.enabled,
    mode: params.policy.mode ?? current.mode,
    minSampleSize: params.policy.minSampleSize ?? current.minSampleSize,
    maxErrorRate: params.policy.maxErrorRate ?? current.maxErrorRate,
    maxLatencyMs: params.policy.maxLatencyMs ?? current.maxLatencyMs,
    minSuccessRate: params.policy.minSuccessRate ?? current.minSuccessRate,
    minTrustScore: params.policy.minTrustScore ?? current.minTrustScore,
    cooldownMinutes: params.policy.cooldownMinutes ?? current.cooldownMinutes,
  };

  const { error } = await admin
    .from("agent_rollback_policies")
    .upsert(
      {
        agent_id: params.agentId,
        enabled: next.enabled,
        mode: next.mode,
        min_sample_size: next.minSampleSize,
        max_error_rate: next.maxErrorRate,
        max_latency_ms: next.maxLatencyMs,
        min_success_rate: next.minSuccessRate,
        min_trust_score: next.minTrustScore,
        cooldown_minutes: next.cooldownMinutes,
        updated_by: params.actorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "agent_id" }
    );

  if (error) {
    throw new Error(`Failed to update rollback policy: ${error.message}`);
  }
}
