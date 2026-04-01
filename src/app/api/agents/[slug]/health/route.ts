import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPublicRateLimit } from "@/lib/auth";

/**
 * GET /api/agents/[slug]/health — Agent health dashboard data.
 *
 * Returns health status, drift events, coaching tips, and trend data.
 * Public endpoint with rate limiting.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const rateLimited = await checkPublicRateLimit(request);
  if (rateLimited) return rateLimited;

  const { slug } = await params;
  const admin = createAdminClient();

  // Fetch agent
  const { data: agent } = await admin
    .from("agents")
    .select("id, name, slug, model_id, health_status, health_score, health_checked_at, total_external_calls, avg_latency_ms")
    .eq("slug", slug)
    .eq("status", "active")
    .single();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const agentId = agent.id as string;

  // Fetch in parallel: health events, coaching tips, recent match trends
  const [healthEventsResult, coachingTipsResult, matchTrendsResult] = await Promise.all([
    // Recent health events (last 30 days)
    admin
      .from("agent_health_events")
      .select("id, event_type, severity, message, metrics_snapshot, detected_at, resolved_at")
      .eq("agent_id", agentId)
      .order("detected_at", { ascending: false })
      .limit(10),

    // Recent coaching tips (last 10)
    admin
      .from("agent_coaching_tips")
      .select("id, category, tip, metric_name, current_value, baseline_value, created_at")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(10),

    // Match performance by week (last 8 weeks)
    admin
      .from("arena_matches")
      .select("winner, judgment_breakdown, duration_a_ms, duration_b_ms, api_cost_a, api_cost_b, agent_a_id, completed_at")
      .eq("status", "completed")
      .or(`agent_a_id.eq.${agentId},agent_b_id.eq.${agentId}`)
      .gte("completed_at", new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString())
      .order("completed_at", { ascending: true }),
  ]);

  // Compute weekly trend buckets
  const weeklyTrends = computeWeeklyTrends(matchTrendsResult.data ?? [], agentId);

  // Active drift alerts (unresolved)
  const activeDrifts = (healthEventsResult.data ?? []).filter(
    (e) => e.event_type === "drift_detected" && !e.resolved_at
  );

  return NextResponse.json(
    {
      agent: {
        slug: agent.slug,
        name: agent.name,
        model_id: agent.model_id,
        total_calls: agent.total_external_calls,
        avg_latency_ms: agent.avg_latency_ms,
      },
      health: {
        status: agent.health_status ?? "unknown",
        score: agent.health_score,
        checked_at: agent.health_checked_at,
        active_drift_alerts: activeDrifts.length,
      },
      events: healthEventsResult.data ?? [],
      coaching: coachingTipsResult.data ?? [],
      trends: weeklyTrends,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    }
  );
}

interface WeekBucket {
  week_start: string;
  matches: number;
  wins: number;
  win_rate: number;
  avg_score: number;
  avg_latency_ms: number;
  avg_api_cost: number;
}

function computeWeeklyTrends(
  matches: Record<string, unknown>[],
  agentId: string
): WeekBucket[] {
  const buckets = new Map<string, {
    matches: number;
    wins: number;
    totalScore: number;
    totalLatency: number;
    totalApiCost: number;
  }>();

  for (const m of matches) {
    const completedAt = new Date(m.completed_at as string);
    // Week start = Monday
    const dayOfWeek = completedAt.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(completedAt);
    weekStart.setDate(weekStart.getDate() - mondayOffset);
    const weekKey = weekStart.toISOString().slice(0, 10);

    if (!buckets.has(weekKey)) {
      buckets.set(weekKey, { matches: 0, wins: 0, totalScore: 0, totalLatency: 0, totalApiCost: 0 });
    }

    const bucket = buckets.get(weekKey)!;
    const isA = m.agent_a_id === agentId;
    const side = isA ? "a" : "b";

    bucket.matches++;
    if (m.winner === side) bucket.wins++;
    else if (m.winner === "tie") bucket.wins += 0.5;

    const breakdown = m.judgment_breakdown as Record<string, unknown> | null;
    if (breakdown) {
      const score = breakdown[`total_${side}`] as number;
      if (score != null) bucket.totalScore += score;
    }

    const latency = (isA ? m.duration_a_ms : m.duration_b_ms) as number;
    if (latency != null) bucket.totalLatency += latency;

    const apiCost = (isA ? m.api_cost_a : m.api_cost_b) as number;
    if (apiCost != null) bucket.totalApiCost += apiCost;
  }

  const weeks: WeekBucket[] = [];
  for (const [weekStart, b] of [...buckets.entries()].sort()) {
    weeks.push({
      week_start: weekStart,
      matches: b.matches,
      wins: b.wins,
      win_rate: b.matches > 0 ? Math.round((b.wins / b.matches) * 1000) / 1000 : 0,
      avg_score: b.matches > 0 ? Math.round((b.totalScore / b.matches) * 1000) / 1000 : 0,
      avg_latency_ms: b.matches > 0 ? Math.round(b.totalLatency / b.matches) : 0,
      avg_api_cost: b.matches > 0 ? Math.round((b.totalApiCost / b.matches) * 1000000) / 1000000 : 0,
    });
  }

  return weeks;
}
