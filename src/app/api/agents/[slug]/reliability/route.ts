import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPublicRateLimit } from "@/lib/auth";
import {
  computeReliabilityScore,
  explainDelta,
  type ReliabilityResult,
} from "@/lib/reliability";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const rateLimited = await checkPublicRateLimit(request);
  if (rateLimited) return rateLimited;

  const { slug } = await params;
  const admin = createAdminClient();

  const { data: agent } = await admin
    .from("agents")
    .select("id, slug, name, reliability_score, reliability_band, reliability_checked_at, traffic_mode, canary_percent, freeze_until")
    .eq("slug", slug)
    .eq("status", "active")
    .single();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const [{ data: snapshots }, { data: incidents }] = await Promise.all([
    admin
      .from("agent_reliability_snapshots")
      .select("id, sample_size, success_rate, error_rate, avg_latency_ms, trust_score, health_component, reliability_score, reliability_band, drivers, created_at")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(2),
    admin
      .from("agent_rollback_incidents")
      .select("id, status, reason, created_at")
      .eq("agent_id", agent.id)
      .in("status", ["open", "acknowledged", "simulated"])
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  const latest = snapshots?.[0] ?? null;
  const previous = snapshots?.[1] ?? null;

  let deltaSummary = "No recent reliability snapshot.";
  if (latest) {
    const currentResult: ReliabilityResult = {
      score: Number(latest.reliability_score ?? 0),
      band: (latest.reliability_band ?? "unknown") as ReliabilityResult["band"],
      drivers: {
        success_component: Number((latest.drivers as Record<string, unknown> | null)?.success_component ?? 0),
        error_component: Number((latest.drivers as Record<string, unknown> | null)?.error_component ?? 0),
        latency_component: Number((latest.drivers as Record<string, unknown> | null)?.latency_component ?? 0),
        trust_component: Number((latest.drivers as Record<string, unknown> | null)?.trust_component ?? 0),
        health_component: Number((latest.drivers as Record<string, unknown> | null)?.health_component ?? 0),
      },
    };

    const previousResult = previous
      ? computeReliabilityScore({
          successRate: Number(previous.success_rate ?? 0),
          errorRate: Number(previous.error_rate ?? 0),
          avgLatencyMs: Number(previous.avg_latency_ms ?? 0),
          trustScore: Number(previous.trust_score ?? 0),
          healthComponent: Number(previous.health_component ?? 0),
        })
      : null;

    deltaSummary = explainDelta(currentResult, previousResult);
  }

  return NextResponse.json({
    agent: {
      slug: agent.slug,
      name: agent.name,
      reliability_score: agent.reliability_score,
      reliability_band: agent.reliability_band,
      reliability_checked_at: agent.reliability_checked_at,
      traffic_mode: agent.traffic_mode,
      canary_percent: agent.canary_percent,
      freeze_until: agent.freeze_until,
    },
    latest_snapshot: latest,
    previous_snapshot: previous,
    active_incidents: incidents ?? [],
    delta_summary: deltaSummary,
    public_proof: {
      reliability_band: agent.reliability_band,
      sample_size: latest?.sample_size ?? null,
      success_rate: latest?.success_rate ?? null,
      error_rate: latest?.error_rate ?? null,
      avg_latency_ms: latest?.avg_latency_ms ?? null,
      active_incident_count: (incidents ?? []).length,
    },
  });
}
