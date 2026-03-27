import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest/client";
import Papa from "papaparse";
import * as XLSX from "xlsx";

/**
 * POST /api/analyst/ingest
 * Upload a CSV or XLSX file → parse → create dataset + records → fire pipeline.
 *
 * Accepts multipart/form-data with:
 *   - file: the CSV or XLSX file
 *   - source_id: UUID of the data source
 *   - name: dataset name
 *   - period: time period (e.g. "2026-Q1")
 *   - template_id: (optional) Brief template to use for final compilation
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasScope(auth, "agents:write")) {
    return NextResponse.json({ error: "Forbidden — insufficient scope" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const sourceId = formData.get("source_id") as string | null;
  const name = formData.get("name") as string | null;
  const period = formData.get("period") as string | null;
  const templateId = formData.get("template_id") as string | null;

  if (!file || !sourceId || !name || !period) {
    return NextResponse.json(
      { error: "Missing required fields: file, source_id, name, period" },
      { status: 400 }
    );
  }

  // Validate file type
  const fileName = file.name.toLowerCase();
  const isCSV = fileName.endsWith(".csv");
  const isXLSX = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");

  if (!isCSV && !isXLSX) {
    return NextResponse.json(
      { error: "Unsupported file type. Please upload a CSV or XLSX file." },
      { status: 400 }
    );
  }

  // Validate source exists and belongs to user
  const { data: source } = await admin
    .from("analyst_sources")
    .select("id")
    .eq("id", sourceId)
    .eq("owner_id", auth.profileId)
    .single();

  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  // Parse the file
  let rows: Record<string, unknown>[] = [];
  let headers: string[] = [];

  try {
    const buffer = await file.arrayBuffer();

    if (isCSV) {
      const text = new TextDecoder().decode(buffer);
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
      });
      rows = parsed.data as Record<string, unknown>[];
      headers = parsed.meta.fields ?? [];
    } else {
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
      if (rows.length > 0) {
        headers = Object.keys(rows[0]);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "File parsing failed";
    return NextResponse.json({ error: `Parse error: ${message}` }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "File contains no data rows" }, { status: 400 });
  }

  // Auto-detect column types — classify each header as dimension, metric, period, or unknown
  const columnMap: Record<string, { type: string; confidence: string }> = {};
  const periodPatterns = /^(date|period|month|quarter|year|week|time|timestamp)$/i;
  const metricPatterns = /^(value|amount|volume|share|rate|price|cost|revenue|growth|count|total|pct|percent|units|dollars)$/i;
  const numericColumns = new Set<string>();

  // Sample first 10 rows to detect numeric columns
  const sample = rows.slice(0, 10);
  for (const header of headers) {
    const values = sample.map((r) => r[header]).filter((v) => v !== null && v !== undefined && v !== "");
    const numericCount = values.filter((v) => typeof v === "number" || !isNaN(Number(v))).length;

    if (numericCount > values.length * 0.7) {
      numericColumns.add(header);
    }
  }

  for (const header of headers) {
    const lower = header.toLowerCase().replace(/[_\s-]+/g, "");

    if (periodPatterns.test(header)) {
      columnMap[header] = { type: "period", confidence: "high" };
    } else if (metricPatterns.test(lower) || numericColumns.has(header)) {
      columnMap[header] = { type: "metric", confidence: numericColumns.has(header) ? "high" : "medium" };
    } else {
      columnMap[header] = { type: "dimension", confidence: "medium" };
    }
  }

  // Create dataset
  const { data: dataset, error: dsError } = await admin
    .from("analyst_datasets")
    .insert({
      owner_id: auth.profileId,
      source_id: sourceId,
      name,
      period,
      row_count: rows.length,
      status: "pending",
    })
    .select("id")
    .single();

  if (dsError || !dataset) {
    return NextResponse.json({ error: "Failed to create dataset" }, { status: 500 });
  }

  // Insert records in batches of 500
  const records = rows.map((row) => {
    // Separate dimension values from metric values based on column map
    const rawValues: Record<string, unknown> = {};
    let metricName: string | null = null;
    let metricValue: number | null = null;
    let recordPeriod: string | null = null;

    for (const [key, val] of Object.entries(row)) {
      rawValues[key] = val;

      const col = columnMap[key];
      if (col?.type === "period" && val) {
        recordPeriod = String(val);
      }
    }

    // If there's exactly one metric column, use it as the primary metric
    const metricHeaders = headers.filter((h) => columnMap[h]?.type === "metric");
    if (metricHeaders.length === 1) {
      metricName = metricHeaders[0];
      const v = row[metricHeaders[0]];
      metricValue = v !== null && v !== undefined ? Number(v) : null;
      if (metricValue !== null && isNaN(metricValue)) metricValue = null;
    }

    return {
      dataset_id: dataset.id,
      raw_values: rawValues,
      normalized_values: rawValues, // will be overwritten by Rosetta
      entity_mappings: {},          // will be populated by Rosetta
      period: recordPeriod ?? period,
      metric_name: metricName,
      metric_value: metricValue,
      flags: [],
    };
  });

  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { error: insertError } = await admin
      .from("analyst_records")
      .insert(batch);

    if (insertError) {
      // Clean up on failure
      await admin.from("analyst_datasets").update({ status: "error" }).eq("id", dataset.id);
      return NextResponse.json(
        { error: `Failed to insert records (batch ${Math.floor(i / 500) + 1}): ${insertError.message}` },
        { status: 500 }
      );
    }
  }

  // Create pipeline run
  const { data: pipelineRun, error: pipelineError } = await admin
    .from("analyst_pipeline_runs")
    .insert({
      dataset_id: dataset.id,
      owner_id: auth.profileId,
      status: "parsing",
      current_step: "File parsed, starting pipeline...",
      steps_completed: 1,
      file_name: file.name,
      file_size: file.size,
      row_count: rows.length,
      column_map: columnMap,
    })
    .select("id")
    .single();

  if (pipelineError || !pipelineRun) {
    return NextResponse.json({ error: "Failed to create pipeline run" }, { status: 500 });
  }

  // Fire the pipeline orchestrator via Inngest
  await inngest.send({
    name: "analyst/pipeline.start",
    data: {
      pipeline_run_id: pipelineRun.id,
      dataset_id: dataset.id,
      owner_id: auth.profileId,
      source_id: sourceId,
      column_map: columnMap,
      template_id: templateId ?? null,
    },
  });

  return NextResponse.json({
    dataset_id: dataset.id,
    pipeline_run_id: pipelineRun.id,
    file_name: file.name,
    row_count: rows.length,
    columns: headers,
    column_map: columnMap,
    status: "pipeline_started",
  }, { status: 201 });
}
