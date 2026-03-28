/**
 * Pulse Engine — account health monitoring.
 *
 * Reads normalized records from the shared data layer and computes
 * health scores per account based on order patterns, volume trends,
 * SKU adoption, and reorder consistency.
 *
 * Capabilities:
 *   1. monitor.scan    — scan all accounts in a dataset for health signals
 *   2. monitor.check   — check a single account's health
 *   3. monitor.history — health trend over time for an account
 */

import { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnalystRecord {
  id: string;
  dataset_id: string;
  entity_mappings: Record<string, string>;
  raw_values: Record<string, unknown>;
  normalized_values: Record<string, unknown>;
  period: string | null;
  metric_name: string | null;
  metric_value: number | null;
}

interface SignalScore {
  score: number;
  trend: "improving" | "stable" | "declining";
  [key: string]: unknown;
}

export interface AccountHealth {
  entity_id: string | null;
  account_name: string;
  health_score: number;
  status: "healthy" | "at_risk" | "declining" | "churned";
  signals: Record<string, SignalScore>;
  last_order_date: string | null;
  days_since_order: number | null;
  risk_factors: Array<{ factor: string; severity: string; detail: string }>;
}

export interface ScanResult {
  dataset_id: string;
  total_accounts: number;
  healthy: number;
  at_risk: number;
  declining: number;
  churned: number;
  accounts: AccountHealth[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMetricValue(r: AnalystRecord, metric: string): number | null {
  const nv = r.normalized_values[metric];
  if (nv !== null && nv !== undefined) {
    const n = Number(nv);
    return isNaN(n) ? null : n;
  }
  if (r.metric_name === metric && r.metric_value !== null) return r.metric_value;
  return null;
}

function parsePeriod(p: string | null): number {
  if (!p) return 0;
  // Handle formats like "2026-Q1", "2026-03", "2026-W12"
  const match = p.match(/(\d{4})/);
  const year = match ? parseInt(match[1]) : 2020;
  const qMatch = p.match(/Q(\d)/i);
  if (qMatch) return year * 12 + parseInt(qMatch[1]) * 3;
  const mMatch = p.match(/-(\d{2})/);
  if (mMatch) return year * 12 + parseInt(mMatch[1]);
  const wMatch = p.match(/W(\d+)/i);
  if (wMatch) return year * 52 + parseInt(wMatch[1]);
  return year * 12;
}

function computeTrend(values: number[]): "improving" | "stable" | "declining" {
  if (values.length < 2) return "stable";
  const recent = values.slice(-Math.ceil(values.length / 2));
  const earlier = values.slice(0, Math.floor(values.length / 2));
  const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
  const earlierAvg = earlier.reduce((s, v) => s + v, 0) / earlier.length;
  const pctChange = earlierAvg !== 0 ? (recentAvg - earlierAvg) / Math.abs(earlierAvg) : 0;
  if (pctChange > 0.05) return "improving";
  if (pctChange < -0.05) return "declining";
  return "stable";
}

function healthStatus(score: number): "healthy" | "at_risk" | "declining" | "churned" {
  if (score >= 70) return "healthy";
  if (score >= 50) return "at_risk";
  if (score >= 20) return "declining";
  return "churned";
}

// ---------------------------------------------------------------------------
// 1. monitor.scan — scan all accounts in a dataset
// ---------------------------------------------------------------------------

export async function scanAccountHealth(
  admin: SupabaseClient,
  ownerId: string,
  datasetId: string,
  accountDimension: string // dimension slug to group by (e.g. "account", "customer")
): Promise<ScanResult> {
  // Load records
  const { data: rawRecords, error } = await admin
    .from("analyst_records")
    .select("id, dataset_id, entity_mappings, raw_values, normalized_values, period, metric_name, metric_value")
    .eq("dataset_id", datasetId);

  if (error) throw new Error(`Failed to load records: ${error.message}`);
  const records = (rawRecords ?? []) as AnalystRecord[];

  // Load entity names
  const entityIds = new Set<string>();
  for (const r of records) {
    const eid = r.entity_mappings[accountDimension];
    if (eid) entityIds.add(eid);
  }

  const entityNames = new Map<string, string>();
  if (entityIds.size > 0) {
    const { data: entities } = await admin
      .from("analyst_entities")
      .select("id, canonical_name")
      .in("id", Array.from(entityIds));
    for (const e of entities ?? []) entityNames.set(e.id, e.canonical_name);
  }

  // Group records by account
  const accountRecords = new Map<string, AnalystRecord[]>();
  for (const r of records) {
    const eid = r.entity_mappings[accountDimension];
    if (!eid) continue;
    const arr = accountRecords.get(eid) ?? [];
    arr.push(r);
    accountRecords.set(eid, arr);
  }

  // Compute health for each account
  const accounts: AccountHealth[] = [];

  for (const [entityId, acctRecords] of accountRecords) {
    const health = computeAccountHealth(entityId, entityNames.get(entityId) ?? entityId, acctRecords);
    accounts.push(health);
  }

  // Sort by health score ascending (worst first)
  accounts.sort((a, b) => a.health_score - b.health_score);

  // Save to DB
  for (const acct of accounts) {
    await admin
      .from("analyst_account_health")
      .upsert(
        {
          owner_id: ownerId,
          dataset_id: datasetId,
          entity_id: acct.entity_id,
          account_name: acct.account_name,
          health_score: acct.health_score,
          status: acct.status,
          signals: acct.signals,
          last_order_date: acct.last_order_date,
          days_since_order: acct.days_since_order,
          risk_factors: acct.risk_factors,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "owner_id,dataset_id,entity_id", ignoreDuplicates: false }
      );
  }

  const counts = {
    healthy: accounts.filter((a) => a.status === "healthy").length,
    at_risk: accounts.filter((a) => a.status === "at_risk").length,
    declining: accounts.filter((a) => a.status === "declining").length,
    churned: accounts.filter((a) => a.status === "churned").length,
  };

  return {
    dataset_id: datasetId,
    total_accounts: accounts.length,
    ...counts,
    accounts,
  };
}

function computeAccountHealth(
  entityId: string,
  accountName: string,
  records: AnalystRecord[]
): AccountHealth {
  const signals: Record<string, SignalScore> = {};
  const riskFactors: Array<{ factor: string; severity: string; detail: string }> = [];

  // Sort records by period
  const sorted = [...records].sort((a, b) => parsePeriod(a.period) - parsePeriod(b.period));
  const periods = sorted.map((r) => r.period).filter(Boolean) as string[];
  const uniquePeriods = [...new Set(periods)];

  // --- Order frequency signal ---
  if (uniquePeriods.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < uniquePeriods.length; i++) {
      intervals.push(parsePeriod(uniquePeriods[i]) - parsePeriod(uniquePeriods[i - 1]));
    }
    const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    const recentInterval = intervals[intervals.length - 1] ?? avgInterval;
    const frequencyScore = recentInterval <= avgInterval * 1.2 ? 80 : recentInterval <= avgInterval * 2 ? 50 : 20;
    const trend = computeTrend(intervals.map((i) => 1 / i)); // inverse: more frequent = higher

    signals.order_frequency = {
      score: frequencyScore,
      trend,
      current_interval: recentInterval,
      previous_avg_interval: avgInterval,
    };

    if (recentInterval > avgInterval * 2) {
      riskFactors.push({
        factor: "Order frequency drop",
        severity: "high",
        detail: `Current order gap is ${(recentInterval / avgInterval).toFixed(1)}x the historical average`,
      });
    }
  }

  // --- Volume trend signal ---
  const volumes: number[] = [];
  for (const r of sorted) {
    const vol = getMetricValue(r, "volume") ?? getMetricValue(r, "units") ?? getMetricValue(r, "quantity");
    if (vol !== null) volumes.push(vol);
  }

  if (volumes.length >= 2) {
    const trend = computeTrend(volumes);
    const recentVol = volumes.slice(-Math.ceil(volumes.length / 3));
    const earlierVol = volumes.slice(0, Math.ceil(volumes.length / 3));
    const recentAvg = recentVol.reduce((s, v) => s + v, 0) / recentVol.length;
    const earlierAvg = earlierVol.reduce((s, v) => s + v, 0) / earlierVol.length;
    const pctChange = earlierAvg !== 0 ? ((recentAvg - earlierAvg) / Math.abs(earlierAvg)) * 100 : 0;

    const volumeScore = pctChange >= 0 ? 80 : pctChange > -20 ? 50 : 20;

    signals.volume_trend = { score: volumeScore, trend, pct_change: Math.round(pctChange * 10) / 10 };

    if (pctChange < -20) {
      riskFactors.push({
        factor: "Volume decline",
        severity: "high",
        detail: `Volume down ${Math.abs(Math.round(pctChange))}% vs earlier periods`,
      });
    }
  }

  // --- Revenue trend signal ---
  const revenues: number[] = [];
  for (const r of sorted) {
    const rev = getMetricValue(r, "revenue") ?? getMetricValue(r, "dollar_sales") ?? getMetricValue(r, "sales");
    if (rev !== null) revenues.push(rev);
  }

  if (revenues.length >= 2) {
    const trend = computeTrend(revenues);
    const recentRev = revenues.slice(-Math.ceil(revenues.length / 3));
    const earlierRev = revenues.slice(0, Math.ceil(revenues.length / 3));
    const recentAvg = recentRev.reduce((s, v) => s + v, 0) / recentRev.length;
    const earlierAvg = earlierRev.reduce((s, v) => s + v, 0) / earlierRev.length;
    const pctChange = earlierAvg !== 0 ? ((recentAvg - earlierAvg) / Math.abs(earlierAvg)) * 100 : 0;

    const revScore = pctChange >= 0 ? 80 : pctChange > -15 ? 50 : 20;

    signals.revenue_trend = { score: revScore, trend, pct_change: Math.round(pctChange * 10) / 10 };

    if (pctChange < -15) {
      riskFactors.push({
        factor: "Revenue decline",
        severity: "medium",
        detail: `Revenue down ${Math.abs(Math.round(pctChange))}% vs earlier periods`,
      });
    }
  }

  // --- SKU adoption signal ---
  const skus = new Set<string>();
  for (const r of records) {
    const sku = r.normalized_values["sku"] ?? r.normalized_values["product"] ?? r.raw_values["sku"] ?? r.raw_values["product"];
    if (sku) skus.add(String(sku));
  }

  if (skus.size > 0) {
    // Simple adoption score based on count — real implementation would compare to available SKUs
    const adoptionScore = Math.min(skus.size * 15, 100);
    signals.sku_adoption = {
      score: adoptionScore,
      trend: "stable",
      active_skus: skus.size,
    };
  }

  // --- Compute composite health score ---
  const signalValues = Object.values(signals);
  const compositeScore = signalValues.length > 0
    ? Math.round(signalValues.reduce((s, sig) => s + sig.score, 0) / signalValues.length)
    : 50;

  // Last order
  const lastPeriod = uniquePeriods[uniquePeriods.length - 1] ?? null;

  return {
    entity_id: entityId,
    account_name: accountName,
    health_score: compositeScore,
    status: healthStatus(compositeScore),
    signals,
    last_order_date: lastPeriod,
    days_since_order: null, // would need actual dates to compute
    risk_factors: riskFactors,
  };
}

// ---------------------------------------------------------------------------
// 2. monitor.check — check a single account
// ---------------------------------------------------------------------------

export async function checkAccountHealth(
  admin: SupabaseClient,
  ownerId: string,
  datasetId: string,
  entityId: string
): Promise<AccountHealth | null> {
  const { data, error } = await admin
    .from("analyst_account_health")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("dataset_id", datasetId)
    .eq("entity_id", entityId)
    .single();

  if (error || !data) return null;

  return {
    entity_id: data.entity_id,
    account_name: data.account_name,
    health_score: data.health_score,
    status: data.status,
    signals: data.signals as Record<string, SignalScore>,
    last_order_date: data.last_order_date,
    days_since_order: data.days_since_order,
    risk_factors: data.risk_factors as Array<{ factor: string; severity: string; detail: string }>,
  };
}

// ---------------------------------------------------------------------------
// 3. monitor.history — health score history across datasets
// ---------------------------------------------------------------------------

export async function getHealthHistory(
  admin: SupabaseClient,
  ownerId: string,
  entityId: string,
  limit: number = 20
): Promise<Array<{ dataset_id: string; health_score: number; status: string; computed_at: string }>> {
  const { data, error } = await admin
    .from("analyst_account_health")
    .select("dataset_id, health_score, status, computed_at")
    .eq("owner_id", ownerId)
    .eq("entity_id", entityId)
    .order("computed_at", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as Array<{ dataset_id: string; health_score: number; status: string; computed_at: string }>;
}
