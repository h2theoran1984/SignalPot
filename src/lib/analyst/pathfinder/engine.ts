/**
 * Pathfinder Engine — investigates anomalies in dataset records.
 *
 * Three capabilities:
 *   1. detectAnomalies — statistical scan for outliers in a metric
 *   2. explainAnomaly — LLM-powered root cause analysis
 *   3. drillDown     — dimension breakdowns with optional filtering
 */

import { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

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
  flags: unknown[];
}

export interface Anomaly {
  id: string;
  dataset_id: string;
  record_id: string | null;
  metric: string;
  value: number;
  expected_mean: number;
  expected_stddev: number;
  z_score: number;
  direction: "high" | "low";
  severity: "error" | "warning" | "info";
  context: Record<string, unknown>;
  explanation: string | null;
  status: string;
  created_at: string;
}

export interface DetectResult {
  dataset_id: string;
  metric: string;
  threshold: number;
  stats: {
    mean: number;
    stddev: number;
    count: number;
    anomaly_count: number;
  };
  anomalies: Anomaly[];
}

export interface ExplainResult {
  anomaly_id: string;
  explanation: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
}

export interface DrillResult {
  dataset_id: string;
  dimension_id: string;
  groups: Array<{
    entity_id: string;
    entity_name: string | null;
    record_count: number;
    metrics: Record<string, { sum: number; avg: number; min: number; max: number; count: number }>;
  }>;
  total_records: number;
}

// ---------------------------------------------------------------------------
// 1. Anomaly Detection — statistical outlier scan
// ---------------------------------------------------------------------------

export async function detectAnomalies(
  admin: SupabaseClient,
  ownerId: string,
  datasetId: string,
  metric: string,
  threshold: number = 2
): Promise<DetectResult> {
  // Load records
  const { data: rawRecords, error } = await admin
    .from("analyst_records")
    .select("id, dataset_id, entity_mappings, raw_values, normalized_values, period, metric_name, metric_value, flags")
    .eq("dataset_id", datasetId);

  if (error) throw new Error(`Failed to load records: ${error.message}`);

  const records = (rawRecords ?? []) as AnalystRecord[];

  // Extract numeric values for the target metric
  const dataPoints: { record: AnalystRecord; value: number }[] = [];
  for (const r of records) {
    let val: number | null = null;
    const nv = r.normalized_values[metric];
    if (nv !== null && nv !== undefined) {
      val = Number(nv);
    } else if (r.metric_name === metric && r.metric_value !== null) {
      val = r.metric_value;
    }
    if (val !== null && !isNaN(val)) {
      dataPoints.push({ record: r, value: val });
    }
  }

  if (dataPoints.length < 3) {
    return {
      dataset_id: datasetId,
      metric,
      threshold,
      stats: { mean: 0, stddev: 0, count: dataPoints.length, anomaly_count: 0 },
      anomalies: [],
    };
  }

  // Compute stats
  const mean = dataPoints.reduce((s, d) => s + d.value, 0) / dataPoints.length;
  const variance = dataPoints.reduce((s, d) => s + (d.value - mean) ** 2, 0) / dataPoints.length;
  const stddev = Math.sqrt(variance);

  if (stddev === 0) {
    return {
      dataset_id: datasetId,
      metric,
      threshold,
      stats: { mean, stddev: 0, count: dataPoints.length, anomaly_count: 0 },
      anomalies: [],
    };
  }

  // Find outliers
  const outliers = dataPoints.filter((d) => Math.abs(d.value - mean) > threshold * stddev);

  // Save anomalies to DB
  const anomalies: Anomaly[] = [];
  for (const outlier of outliers) {
    const zScore = (outlier.value - mean) / stddev;
    const direction = zScore > 0 ? "high" : "low";
    const abZ = Math.abs(zScore);
    const severity: "error" | "warning" | "info" =
      abZ > 3 ? "error" : abZ > 2 ? "warning" : "info";

    const context: Record<string, unknown> = {
      entity_mappings: outlier.record.entity_mappings,
      period: outlier.record.period,
      metric_name: outlier.record.metric_name,
    };

    const { data: saved, error: saveError } = await admin
      .from("analyst_anomalies")
      .insert({
        dataset_id: datasetId,
        owner_id: ownerId,
        record_id: outlier.record.id,
        metric,
        value: outlier.value,
        expected_mean: mean,
        expected_stddev: stddev,
        z_score: zScore,
        direction,
        severity,
        context,
      })
      .select("id, dataset_id, record_id, metric, value, expected_mean, expected_stddev, z_score, direction, severity, context, explanation, status, created_at")
      .single();

    if (!saveError && saved) {
      anomalies.push(saved as Anomaly);
    }
  }

  return {
    dataset_id: datasetId,
    metric,
    threshold,
    stats: {
      mean,
      stddev,
      count: dataPoints.length,
      anomaly_count: anomalies.length,
    },
    anomalies,
  };
}

// ---------------------------------------------------------------------------
// 2. Explain — LLM-powered root cause analysis
// ---------------------------------------------------------------------------

const EXPLAIN_SYSTEM = `You are a data analyst investigating an anomaly in a market analytics dataset.

You will receive context about an anomalous data point including:
- The metric, its value, and how far it deviates from the norm
- Surrounding data context (entity mappings, period, etc.)
- Other records from the same dataset for comparison

Provide a concise, actionable root cause analysis:
1. Why this value might be anomalous
2. Possible explanations (data entry error, seasonal effect, market event, methodology change, etc.)
3. Recommended next steps to investigate further

Be specific and grounded in the data provided. Do not speculate beyond what the data supports.`;

export async function explainAnomaly(
  admin: SupabaseClient,
  ownerId: string,
  anomalyId: string,
  apiKey: string
): Promise<ExplainResult> {
  // Load the anomaly
  const { data: anomaly, error: anomalyError } = await admin
    .from("analyst_anomalies")
    .select("*")
    .eq("id", anomalyId)
    .eq("owner_id", ownerId)
    .single();

  if (anomalyError || !anomaly) {
    throw new Error("Anomaly not found");
  }

  // Load nearby records from the same dataset for comparison context
  const { data: nearbyRecords } = await admin
    .from("analyst_records")
    .select("entity_mappings, normalized_values, period, metric_name, metric_value")
    .eq("dataset_id", anomaly.dataset_id)
    .limit(30);

  // Build context for the LLM
  const nearby = (nearbyRecords ?? [])
    .filter((r: Record<string, unknown>) => {
      const mn = r.metric_name as string | null;
      return mn === anomaly.metric || r.normalized_values !== undefined;
    })
    .slice(0, 20)
    .map((r: Record<string, unknown>) => ({
      entity_mappings: r.entity_mappings,
      period: r.period,
      metric: r.metric_name,
      value: r.metric_value,
      values: r.normalized_values,
    }));

  const prompt = `ANOMALY DETAILS:
- Metric: ${anomaly.metric}
- Value: ${anomaly.value}
- Expected Mean: ${Number(anomaly.expected_mean).toFixed(2)}
- Expected Std Dev: ${Number(anomaly.expected_stddev).toFixed(2)}
- Z-Score: ${Number(anomaly.z_score).toFixed(2)} (${anomaly.direction} outlier)
- Severity: ${anomaly.severity}
- Context: ${JSON.stringify(anomaly.context, null, 2)}

COMPARISON DATA (other records from same dataset):
${JSON.stringify(nearby, null, 2)}

Please analyze this anomaly and provide a root cause explanation.`;

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: EXPLAIN_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  const explanation = response.content[0].type === "text" ? response.content[0].text : "";

  // Save explanation back to anomaly
  await admin
    .from("analyst_anomalies")
    .update({
      explanation,
      explanation_model: "claude-sonnet-4-20250514",
      explained_at: new Date().toISOString(),
    })
    .eq("id", anomalyId);

  return {
    anomaly_id: anomalyId,
    explanation,
    model: "claude-sonnet-4-20250514",
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
}

// ---------------------------------------------------------------------------
// 3. Drill Down — dimension breakdowns with filtering
// ---------------------------------------------------------------------------

export async function drillDown(
  admin: SupabaseClient,
  ownerId: string,
  datasetId: string,
  dimensionId: string,
  filters?: Record<string, unknown>
): Promise<DrillResult> {
  // Load the dimension to get the slug
  const { data: dimension, error: dimError } = await admin
    .from("analyst_dimensions")
    .select("id, slug")
    .eq("id", dimensionId)
    .eq("owner_id", ownerId)
    .single();

  if (dimError || !dimension) {
    throw new Error("Dimension not found");
  }

  // Load records for this dataset
  const { data: rawRecords, error } = await admin
    .from("analyst_records")
    .select("id, entity_mappings, raw_values, normalized_values, period, metric_name, metric_value")
    .eq("dataset_id", datasetId);

  if (error) throw new Error(`Failed to load records: ${error.message}`);

  let records = (rawRecords ?? []) as AnalystRecord[];

  // Apply optional filters
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      records = records.filter((r) => {
        const rv = r.normalized_values[key] ?? r.raw_values[key] ?? r.entity_mappings[key];
        if (rv === undefined) return false;
        return String(rv) === String(value);
      });
    }
  }

  // Group by entity_id within the target dimension
  const groups = new Map<string, {
    entity_id: string;
    records: AnalystRecord[];
  }>();

  for (const r of records) {
    const entityId = r.entity_mappings[dimension.slug];
    if (!entityId) continue;

    const group = groups.get(entityId) ?? { entity_id: entityId, records: [] };
    group.records.push(r);
    groups.set(entityId, group);
  }

  // Load entity names for display
  const entityIds = Array.from(groups.keys());
  let entityNames = new Map<string, string>();
  if (entityIds.length > 0) {
    const { data: entities } = await admin
      .from("analyst_entities")
      .select("id, canonical_name")
      .in("id", entityIds);

    for (const e of entities ?? []) {
      entityNames.set(e.id, e.canonical_name);
    }
  }

  // Compute metrics per group
  const result: DrillResult["groups"] = [];

  for (const [entityId, group] of groups) {
    const metrics: Record<string, { sum: number; avg: number; min: number; max: number; count: number }> = {};

    for (const r of group.records) {
      // Collect all numeric values from normalized_values
      const valuesToProcess: Array<[string, number]> = [];

      for (const [key, val] of Object.entries(r.normalized_values)) {
        const num = Number(val);
        if (!isNaN(num)) valuesToProcess.push([key, num]);
      }

      // Also include metric_name/metric_value
      if (r.metric_name && r.metric_value !== null) {
        valuesToProcess.push([r.metric_name, r.metric_value]);
      }

      for (const [key, num] of valuesToProcess) {
        if (!metrics[key]) {
          metrics[key] = { sum: 0, avg: 0, min: Infinity, max: -Infinity, count: 0 };
        }
        metrics[key].sum += num;
        metrics[key].min = Math.min(metrics[key].min, num);
        metrics[key].max = Math.max(metrics[key].max, num);
        metrics[key].count++;
      }
    }

    // Compute averages
    for (const m of Object.values(metrics)) {
      m.avg = m.count > 0 ? m.sum / m.count : 0;
    }

    result.push({
      entity_id: entityId,
      entity_name: entityNames.get(entityId) ?? null,
      record_count: group.records.length,
      metrics,
    });
  }

  // Sort by record count desc
  result.sort((a, b) => b.record_count - a.record_count);

  return {
    dataset_id: datasetId,
    dimension_id: dimensionId,
    groups: result,
    total_records: records.length,
  };
}

// ---------------------------------------------------------------------------
// Helpers for fetching anomalies
// ---------------------------------------------------------------------------

export async function getAnomaliesByDataset(
  admin: SupabaseClient,
  ownerId: string,
  datasetId: string,
  limit: number = 50
): Promise<Anomaly[]> {
  const { data, error } = await admin
    .from("analyst_anomalies")
    .select("id, dataset_id, record_id, metric, value, expected_mean, expected_stddev, z_score, direction, severity, context, explanation, status, created_at")
    .eq("dataset_id", datasetId)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as Anomaly[];
}

export async function updateAnomalyStatus(
  admin: SupabaseClient,
  ownerId: string,
  anomalyId: string,
  status: "open" | "acknowledged" | "resolved" | "false_positive"
): Promise<boolean> {
  const { error } = await admin
    .from("analyst_anomalies")
    .update({ status })
    .eq("id", anomalyId)
    .eq("owner_id", ownerId);

  return !error;
}
