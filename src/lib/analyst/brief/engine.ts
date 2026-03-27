/**
 * Brief Engine — template-driven data compilation.
 *
 * Four output types, each driven by a JSON params object:
 *   1. compileReport  — structured report with named sections
 *   2. compileSlides  — slide deck structure
 *   3. compileTable   — pivot-style dimension x metric table
 *   4. compileChart   — chart-ready data series
 *
 * Params can come from:
 *   - A saved template (template_id)
 *   - Inline params
 *   - Both (template as base, inline as overrides)
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

export interface TemplateParams {
  // report
  sections?: string[];
  metrics?: string[];
  group_by?: string;
  period_compare?: boolean;
  include_charts?: boolean;
  tone?: string;

  // slide
  slide_count?: number;
  slides?: Array<{
    type: string;
    content?: string;
    metric?: string;
    metrics?: string[];
    chart_type?: string;
    dimensions?: string[];
    group_by?: string;
    top_n?: number;
    count?: number;
  }>;
  theme?: string;

  // table
  dimensions?: string[];
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  top_n?: number;
  include_totals?: boolean;
  include_pct_change?: boolean;

  // chart
  chart_type?: "bar" | "line" | "pie" | "scatter" | "heatmap";
  x?: string;
  y?: string;
  show_labels?: boolean;
  color_scheme?: string;

  [key: string]: unknown;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  output_type: string;
  params: TemplateParams;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Merge template params with inline overrides (inline wins). */
function mergeParams(base: TemplateParams, overrides: TemplateParams): TemplateParams {
  return { ...base, ...overrides };
}

/** Load a template by ID. */
async function loadTemplate(
  admin: SupabaseClient,
  ownerId: string,
  templateId: string
): Promise<Template | null> {
  const { data, error } = await admin
    .from("analyst_templates")
    .select("id, name, description, output_type, params")
    .eq("id", templateId)
    .eq("owner_id", ownerId)
    .single();

  if (error || !data) return null;
  return data as Template;
}

/** Load records from one or more datasets. */
async function loadRecords(
  admin: SupabaseClient,
  datasetIds: string[]
): Promise<AnalystRecord[]> {
  const { data, error } = await admin
    .from("analyst_records")
    .select("id, dataset_id, entity_mappings, raw_values, normalized_values, period, metric_name, metric_value")
    .in("dataset_id", datasetIds);

  if (error) throw new Error(`Failed to load records: ${error.message}`);
  return (data ?? []) as AnalystRecord[];
}

/** Load entity names for display. */
async function loadEntityNames(
  admin: SupabaseClient,
  entityIds: string[]
): Promise<Map<string, string>> {
  if (entityIds.length === 0) return new Map();
  const { data } = await admin
    .from("analyst_entities")
    .select("id, canonical_name")
    .in("id", entityIds);

  const map = new Map<string, string>();
  for (const e of data ?? []) {
    map.set(e.id, e.canonical_name);
  }
  return map;
}

/** Get numeric value from a record for a given metric. */
function getMetricValue(r: AnalystRecord, metric: string): number | null {
  const nv = r.normalized_values[metric];
  if (nv !== null && nv !== undefined) {
    const n = Number(nv);
    return isNaN(n) ? null : n;
  }
  if (r.metric_name === metric && r.metric_value !== null) {
    return r.metric_value;
  }
  return null;
}

/** Get the group key for a record (entity name for a dimension slug). */
function getGroupKey(r: AnalystRecord, groupBy: string, entityNames: Map<string, string>): string {
  const entityId = r.entity_mappings[groupBy];
  if (entityId) return entityNames.get(entityId) ?? entityId;
  // Fall back to raw/normalized value
  const val = r.normalized_values[groupBy] ?? r.raw_values[groupBy];
  return val !== null && val !== undefined ? String(val) : "Unknown";
}

/** Resolve final params from template_id + inline params. */
export async function resolveParams(
  admin: SupabaseClient,
  ownerId: string,
  templateId: string | undefined,
  inlineParams: TemplateParams
): Promise<{ params: TemplateParams; template: Template | null }> {
  let template: Template | null = null;
  let baseParams: TemplateParams = {};

  if (templateId) {
    template = await loadTemplate(admin, ownerId, templateId);
    if (template) {
      baseParams = template.params;
    }
  }

  return { params: mergeParams(baseParams, inlineParams), template };
}

// ---------------------------------------------------------------------------
// 1. compile.report — structured report with named sections
// ---------------------------------------------------------------------------

export interface ReportOutput {
  title: string;
  generated_at: string;
  dataset_ids: string[];
  template_id: string | null;
  sections: Array<{
    name: string;
    data: Record<string, unknown>;
  }>;
}

export async function compileReport(
  admin: SupabaseClient,
  ownerId: string,
  datasetIds: string[],
  title: string,
  templateId?: string,
  inlineParams: TemplateParams = {}
): Promise<ReportOutput> {
  const { params, template } = await resolveParams(admin, ownerId, templateId, inlineParams);
  const records = await loadRecords(admin, datasetIds);

  const sectionNames = params.sections ?? ["overview", "metrics", "breakdown"];
  const metrics = params.metrics ?? [];
  const groupBy = params.group_by;

  // Collect all entity IDs for name resolution
  const allEntityIds = new Set<string>();
  for (const r of records) {
    for (const eid of Object.values(r.entity_mappings)) {
      allEntityIds.add(eid);
    }
  }
  const entityNames = await loadEntityNames(admin, Array.from(allEntityIds));

  const sections: ReportOutput["sections"] = [];

  for (const sectionName of sectionNames) {
    const data: Record<string, unknown> = {};

    switch (sectionName) {
      case "overview":
      case "executive_summary": {
        data.record_count = records.length;
        data.dataset_count = datasetIds.length;
        data.periods = [...new Set(records.map((r) => r.period).filter(Boolean))];
        if (metrics.length > 0) {
          data.metric_summary = {};
          for (const m of metrics) {
            const vals = records.map((r) => getMetricValue(r, m)).filter((v): v is number => v !== null);
            if (vals.length > 0) {
              (data.metric_summary as Record<string, unknown>)[m] = {
                count: vals.length,
                mean: vals.reduce((s, v) => s + v, 0) / vals.length,
                min: Math.min(...vals),
                max: Math.max(...vals),
              };
            }
          }
        }
        break;
      }

      case "market_overview":
      case "metrics": {
        data.metrics = {};
        const targetMetrics = metrics.length > 0
          ? metrics
          : [...new Set(records.map((r) => r.metric_name).filter(Boolean))] as string[];

        for (const m of targetMetrics) {
          const vals = records.map((r) => getMetricValue(r, m)).filter((v): v is number => v !== null);
          if (vals.length > 0) {
            const sorted = [...vals].sort((a, b) => a - b);
            (data.metrics as Record<string, unknown>)[m] = {
              count: vals.length,
              sum: vals.reduce((s, v) => s + v, 0),
              mean: vals.reduce((s, v) => s + v, 0) / vals.length,
              median: sorted[Math.floor(sorted.length / 2)],
              min: sorted[0],
              max: sorted[sorted.length - 1],
            };
          }
        }
        break;
      }

      case "competitive_landscape":
      case "breakdown": {
        const dim = groupBy;
        if (dim) {
          const groups = new Map<string, number[]>();
          const primaryMetric = metrics[0] ?? records.find((r) => r.metric_name)?.metric_name ?? "value";

          for (const r of records) {
            const key = getGroupKey(r, dim, entityNames);
            const val = getMetricValue(r, primaryMetric);
            if (val !== null) {
              const arr = groups.get(key) ?? [];
              arr.push(val);
              groups.set(key, arr);
            }
          }

          data.dimension = dim;
          data.metric = primaryMetric;
          data.groups = Array.from(groups.entries())
            .map(([name, vals]) => ({
              name,
              count: vals.length,
              sum: vals.reduce((s, v) => s + v, 0),
              avg: vals.reduce((s, v) => s + v, 0) / vals.length,
            }))
            .sort((a, b) => b.sum - a.sum);
        }
        break;
      }

      case "recommendations":
      case "takeaways": {
        // Provide data context for the caller/LLM to generate recommendations
        data.note = "Recommendations section — populate with LLM analysis or manual input";
        data.data_context = {
          record_count: records.length,
          metrics_available: [...new Set(records.map((r) => r.metric_name).filter(Boolean))],
          periods: [...new Set(records.map((r) => r.period).filter(Boolean))],
        };
        break;
      }

      default: {
        data.note = `Custom section "${sectionName}" — no built-in handler`;
        data.record_count = records.length;
        break;
      }
    }

    sections.push({ name: sectionName, data });
  }

  return {
    title,
    generated_at: new Date().toISOString(),
    dataset_ids: datasetIds,
    template_id: template?.id ?? null,
    sections,
  };
}

// ---------------------------------------------------------------------------
// 2. compile.slide — slide deck structure
// ---------------------------------------------------------------------------

export interface SlideOutput {
  title: string;
  generated_at: string;
  dataset_ids: string[];
  template_id: string | null;
  slides: Array<{
    index: number;
    type: string;
    content: Record<string, unknown>;
  }>;
}

export async function compileSlides(
  admin: SupabaseClient,
  ownerId: string,
  datasetIds: string[],
  title: string,
  templateId?: string,
  inlineParams: TemplateParams = {}
): Promise<SlideOutput> {
  const { params, template } = await resolveParams(admin, ownerId, templateId, inlineParams);
  const records = await loadRecords(admin, datasetIds);

  const allEntityIds = new Set<string>();
  for (const r of records) {
    for (const eid of Object.values(r.entity_mappings)) allEntityIds.add(eid);
  }
  const entityNames = await loadEntityNames(admin, Array.from(allEntityIds));

  // Use slide definitions from template, or generate defaults
  const slideDefs = params.slides ?? [
    { type: "title" },
    { type: "kpi_grid", metrics: params.metrics ?? [], top_n: 5 },
    { type: "chart", chart_type: "bar", metric: params.metrics?.[0] ?? "value", group_by: params.group_by },
    { type: "table", dimensions: params.dimensions ?? [], metrics: params.metrics ?? [] },
    { type: "takeaways", count: 3 },
  ];

  const slides: SlideOutput["slides"] = [];

  for (let i = 0; i < slideDefs.length; i++) {
    const def = slideDefs[i];
    const content: Record<string, unknown> = {};

    switch (def.type) {
      case "title": {
        content.title = def.content ?? title;
        content.subtitle = `${records.length} records across ${datasetIds.length} dataset(s)`;
        content.periods = [...new Set(records.map((r) => r.period).filter(Boolean))];
        break;
      }

      case "kpi_grid": {
        const kpiMetrics = def.metrics ?? params.metrics ?? [];
        content.kpis = [];
        for (const m of kpiMetrics) {
          const vals = records.map((r) => getMetricValue(r, m)).filter((v): v is number => v !== null);
          if (vals.length > 0) {
            (content.kpis as unknown[]).push({
              metric: m,
              value: vals.reduce((s, v) => s + v, 0) / vals.length,
              count: vals.length,
              min: Math.min(...vals),
              max: Math.max(...vals),
            });
          }
        }
        break;
      }

      case "chart": {
        const chartMetric = def.metric ?? params.metrics?.[0] ?? "value";
        const chartGroup = def.group_by ?? params.group_by;
        const topN = def.top_n ?? 10;

        if (chartGroup) {
          const groups = new Map<string, number[]>();
          for (const r of records) {
            const key = getGroupKey(r, chartGroup, entityNames);
            const val = getMetricValue(r, chartMetric);
            if (val !== null) {
              const arr = groups.get(key) ?? [];
              arr.push(val);
              groups.set(key, arr);
            }
          }

          content.chart_type = def.chart_type ?? "bar";
          content.metric = chartMetric;
          content.group_by = chartGroup;
          content.series = Array.from(groups.entries())
            .map(([label, vals]) => ({
              label,
              value: vals.reduce((s, v) => s + v, 0) / vals.length,
              count: vals.length,
            }))
            .sort((a, b) => b.value - a.value)
            .slice(0, topN);
        }
        break;
      }

      case "table": {
        const tableDims = def.dimensions ?? params.dimensions ?? [];
        const tableMetrics = def.metrics ?? params.metrics ?? [];
        content.dimensions = tableDims;
        content.metrics = tableMetrics;
        // Build a simple grouped table
        const rows: Array<Record<string, unknown>> = [];
        for (const r of records) {
          const row: Record<string, unknown> = {};
          for (const dim of tableDims) {
            row[dim] = getGroupKey(r, dim, entityNames);
          }
          for (const m of tableMetrics) {
            row[m] = getMetricValue(r, m);
          }
          row.period = r.period;
          rows.push(row);
        }
        content.rows = rows.slice(0, params.top_n ?? 100);
        content.total_rows = rows.length;
        break;
      }

      case "takeaways": {
        content.note = "Takeaways slide — populate with LLM analysis or manual input";
        content.count = def.count ?? 3;
        content.data_context = {
          record_count: records.length,
          metrics: [...new Set(records.map((r) => r.metric_name).filter(Boolean))],
        };
        break;
      }

      default: {
        content.type = def.type;
        content.raw_def = def;
        break;
      }
    }

    slides.push({ index: i, type: def.type, content });
  }

  return {
    title,
    generated_at: new Date().toISOString(),
    dataset_ids: datasetIds,
    template_id: template?.id ?? null,
    slides,
  };
}

// ---------------------------------------------------------------------------
// 3. compile.table — pivot-style dimension x metric table
// ---------------------------------------------------------------------------

export interface TableOutput {
  generated_at: string;
  dataset_id: string;
  template_id: string | null;
  dimensions: string[];
  metrics: string[];
  rows: Array<Record<string, unknown>>;
  totals: Record<string, number> | null;
  total_rows: number;
}

export async function compileTable(
  admin: SupabaseClient,
  ownerId: string,
  datasetId: string,
  dimensionIds: string[],
  metricNames: string[],
  templateId?: string,
  inlineParams: TemplateParams = {}
): Promise<TableOutput> {
  const { params, template } = await resolveParams(admin, ownerId, templateId, inlineParams);
  const records = await loadRecords(admin, [datasetId]);

  // Load dimension slugs
  const { data: dims } = await admin
    .from("analyst_dimensions")
    .select("id, slug, name")
    .in("id", dimensionIds);

  const dimSlugs = (dims ?? []).map((d) => d.slug);
  const dimNames = new Map((dims ?? []).map((d) => [d.slug, d.name]));

  // Load entity names
  const allEntityIds = new Set<string>();
  for (const r of records) {
    for (const eid of Object.values(r.entity_mappings)) allEntityIds.add(eid);
  }
  const entityNames = await loadEntityNames(admin, Array.from(allEntityIds));

  // Merge metric names from params
  const allMetrics = [...new Set([...metricNames, ...(params.metrics ?? [])])];

  // Build rows
  const rows: Array<Record<string, unknown>> = [];
  for (const r of records) {
    const row: Record<string, unknown> = {};

    for (const slug of dimSlugs) {
      const entityId = r.entity_mappings[slug];
      row[dimNames.get(slug) ?? slug] = entityId ? (entityNames.get(entityId) ?? entityId) : null;
    }

    for (const m of allMetrics) {
      row[m] = getMetricValue(r, m);
    }

    row.period = r.period;
    rows.push(row);
  }

  // Sort
  const sortBy = params.sort_by ?? allMetrics[0];
  const sortDir = params.sort_dir ?? "desc";
  if (sortBy) {
    rows.sort((a, b) => {
      const av = Number(a[sortBy]) || 0;
      const bv = Number(b[sortBy]) || 0;
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }

  // Top N
  const topN = params.top_n ?? rows.length;
  const sliced = rows.slice(0, topN);

  // Totals
  let totals: Record<string, number> | null = null;
  if (params.include_totals) {
    totals = {};
    for (const m of allMetrics) {
      totals[m] = sliced.reduce((s, r) => s + (Number(r[m]) || 0), 0);
    }
  }

  return {
    generated_at: new Date().toISOString(),
    dataset_id: datasetId,
    template_id: template?.id ?? null,
    dimensions: dimSlugs.map((s) => dimNames.get(s) ?? s),
    metrics: allMetrics,
    rows: sliced,
    totals,
    total_rows: rows.length,
  };
}

// ---------------------------------------------------------------------------
// 4. compile.chart — chart-ready data series
// ---------------------------------------------------------------------------

export interface ChartOutput {
  generated_at: string;
  dataset_id: string;
  template_id: string | null;
  chart_type: string;
  x_axis: string;
  y_axis: string;
  group_by: string | null;
  series: Array<{
    label: string;
    data: Array<{ x: string | number; y: number }>;
  }>;
}

export async function compileChart(
  admin: SupabaseClient,
  ownerId: string,
  datasetId: string,
  chartType: string,
  xField: string,
  yField: string,
  groupByField?: string,
  templateId?: string,
  inlineParams: TemplateParams = {}
): Promise<ChartOutput> {
  const { params, template } = await resolveParams(admin, ownerId, templateId, inlineParams);
  const records = await loadRecords(admin, [datasetId]);

  const finalChartType = params.chart_type ?? chartType;
  const finalX = params.x ?? xField;
  const finalY = params.y ?? yField;
  const finalGroupBy = params.group_by ?? groupByField ?? null;
  const topN = params.top_n;

  // Load entity names
  const allEntityIds = new Set<string>();
  for (const r of records) {
    for (const eid of Object.values(r.entity_mappings)) allEntityIds.add(eid);
  }
  const entityNames = await loadEntityNames(admin, Array.from(allEntityIds));

  if (finalGroupBy) {
    // Multi-series: group records by groupBy, each group becomes a series
    const groups = new Map<string, Array<{ x: string | number; y: number }>>();

    for (const r of records) {
      const groupKey = getGroupKey(r, finalGroupBy, entityNames);
      const xVal = r.entity_mappings[finalX]
        ? (entityNames.get(r.entity_mappings[finalX]) ?? r.entity_mappings[finalX])
        : (r.normalized_values[finalX] ?? r.raw_values[finalX] ?? r.period ?? "");
      const yVal = getMetricValue(r, finalY);

      if (yVal === null) continue;

      const arr = groups.get(groupKey) ?? [];
      arr.push({ x: String(xVal), y: yVal });
      groups.set(groupKey, arr);
    }

    let series = Array.from(groups.entries()).map(([label, data]) => ({ label, data }));

    // Sort series by total Y desc and limit
    series.sort((a, b) => {
      const aSum = a.data.reduce((s, d) => s + d.y, 0);
      const bSum = b.data.reduce((s, d) => s + d.y, 0);
      return bSum - aSum;
    });
    if (topN) series = series.slice(0, topN);

    return {
      generated_at: new Date().toISOString(),
      dataset_id: datasetId,
      template_id: template?.id ?? null,
      chart_type: finalChartType,
      x_axis: finalX,
      y_axis: finalY,
      group_by: finalGroupBy,
      series,
    };
  }

  // Single series
  const data: Array<{ x: string | number; y: number }> = [];

  for (const r of records) {
    const xVal = r.entity_mappings[finalX]
      ? (entityNames.get(r.entity_mappings[finalX]) ?? r.entity_mappings[finalX])
      : (r.normalized_values[finalX] ?? r.raw_values[finalX] ?? r.period ?? "");
    const yVal = getMetricValue(r, finalY);

    if (yVal === null) continue;
    data.push({ x: String(xVal), y: yVal });
  }

  // Sort and limit
  data.sort((a, b) => b.y - a.y);
  const sliced = topN ? data.slice(0, topN) : data;

  return {
    generated_at: new Date().toISOString(),
    dataset_id: datasetId,
    template_id: template?.id ?? null,
    chart_type: finalChartType,
    x_axis: finalX,
    y_axis: finalY,
    group_by: null,
    series: [{ label: finalY, data: sliced }],
  };
}
