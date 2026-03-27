/**
 * Analyst Pipeline Orchestrator
 *
 * Inngest step function that chains the full agent pipeline:
 *   1. Column mapping (auto-detect dimensions/metrics)
 *   2. Rosetta normalization (entity resolution)
 *   3. Sentinel validation (rule checks)
 *   4. Pathfinder investigation (anomaly detection)
 *   5. Brief compilation (report generation)
 *
 * Each step updates the pipeline_runs table with progress,
 * so the UI can poll for live status.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveNames } from "@/lib/analyst/rosetta/engine";
import { runValidation } from "@/lib/analyst/sentinel/engine";
import { detectAnomalies } from "@/lib/analyst/pathfinder/engine";
import { compileReport } from "@/lib/analyst/brief/engine";

interface PipelineEventData {
  pipeline_run_id: string;
  dataset_id: string;
  owner_id: string;
  source_id: string;
  column_map: Record<string, { type: string; confidence: string }>;
  template_id: string | null;
}

async function updatePipeline(
  pipelineRunId: string,
  updates: Record<string, unknown>
) {
  const admin = createAdminClient();
  await admin
    .from("analyst_pipeline_runs")
    .update(updates)
    .eq("id", pipelineRunId);
}

export const analystPipeline = inngest.createFunction(
  {
    id: "analyst-pipeline",
    name: "Analyst Suite — Full Pipeline",
    retries: 1,
  },
  { event: "analyst/pipeline.start" },
  async ({ event, step }) => {
    const data = event.data as PipelineEventData;
    const { pipeline_run_id, dataset_id, owner_id, column_map, template_id } = data;

    const results: Record<string, unknown> = {};

    // ─── Step 1: Column Mapping ────────────────────────────────────────
    const mappingResult = await step.run("column-mapping", async () => {
      const admin = createAdminClient();

      await updatePipeline(pipeline_run_id, {
        status: "normalizing",
        current_step: "Mapping columns to dimensions...",
        steps_completed: 1,
      });

      // Load user's dimensions for smart mapping
      const { data: dimensions } = await admin
        .from("analyst_dimensions")
        .select("id, slug, name")
        .eq("owner_id", owner_id);

      const dimMap: Record<string, string> = {};
      const dimensionColumns = Object.entries(column_map)
        .filter(([, v]) => v.type === "dimension")
        .map(([k]) => k);

      // Simple heuristic: match column names to dimension slugs/names
      for (const col of dimensionColumns) {
        const colLower = col.toLowerCase().replace(/[_\s-]+/g, "");
        for (const dim of dimensions ?? []) {
          const slugLower = dim.slug.replace(/-/g, "");
          const nameLower = dim.name.toLowerCase().replace(/[_\s-]+/g, "");
          if (colLower === slugLower || colLower === nameLower || colLower.includes(slugLower)) {
            dimMap[col] = dim.id;
            break;
          }
        }
      }

      return {
        dimension_columns: dimensionColumns,
        matched_dimensions: dimMap,
        total_dimensions: dimensions?.length ?? 0,
      };
    });

    results.column_mapping = mappingResult;

    // ─── Step 2: Rosetta Normalization ─────────────────────────────────
    const rosettaResult = await step.run("rosetta-normalize", async () => {
      const admin = createAdminClient();

      await updatePipeline(pipeline_run_id, {
        status: "normalizing",
        current_step: "Rosetta is resolving entity names...",
        steps_completed: 2,
      });

      const apiKey = process.env.ANTHROPIC_API_KEY;
      let totalResolved = 0;
      let totalUnresolved = 0;
      let totalNew = 0;

      // For each matched dimension, resolve the unique values in that column
      for (const [colName, dimensionId] of Object.entries(mappingResult.matched_dimensions)) {
        // Get unique values for this column from records
        const { data: records } = await admin
          .from("analyst_records")
          .select("id, raw_values")
          .eq("dataset_id", dataset_id);

        const uniqueValues = [
          ...new Set(
            (records ?? [])
              .map((r) => {
                const rv = r.raw_values as Record<string, unknown>;
                return rv[colName];
              })
              .filter((v): v is string => typeof v === "string" && v.length > 0)
          ),
        ];

        if (uniqueValues.length === 0) continue;

        // Run Rosetta resolution
        const result = await resolveNames(
          admin,
          owner_id,
          dimensionId,
          uniqueValues,
          { apiKey, skipSmartPass: !apiKey }
        );

        totalResolved += result.stats.resolved;
        totalUnresolved += result.stats.unresolved;
        totalNew += result.stats.newEntities;

        // Write entity_mappings back to records
        const entityLookup = new Map<string, string>();
        for (const r of result.resolved) {
          entityLookup.set(r.input, r.entityId);
        }

        // Load dimension slug for the mapping key
        const { data: dim } = await admin
          .from("analyst_dimensions")
          .select("slug")
          .eq("id", dimensionId)
          .single();

        const slug = dim?.slug ?? dimensionId;

        // Batch update records with entity mappings
        for (const record of records ?? []) {
          const rv = record.raw_values as Record<string, unknown>;
          const val = rv[colName];
          if (typeof val === "string" && entityLookup.has(val)) {
            const { data: existing } = await admin
              .from("analyst_records")
              .select("entity_mappings")
              .eq("id", record.id)
              .single();

            const mappings = (existing?.entity_mappings as Record<string, string>) ?? {};
            mappings[slug] = entityLookup.get(val)!;

            await admin
              .from("analyst_records")
              .update({ entity_mappings: mappings })
              .eq("id", record.id);
          }
        }
      }

      // Update dataset status
      await admin
        .from("analyst_datasets")
        .update({ status: "normalizing" })
        .eq("id", dataset_id);

      return { totalResolved, totalUnresolved, totalNew };
    });

    results.rosetta = rosettaResult;

    // ─── Step 3: Sentinel Validation ───────────────────────────────────
    const sentinelResult = await step.run("sentinel-validate", async () => {
      const admin = createAdminClient();

      await updatePipeline(pipeline_run_id, {
        status: "validating",
        current_step: "Sentinel is checking data quality...",
        steps_completed: 3,
      });

      try {
        const result = await runValidation(admin, owner_id, dataset_id);
        return {
          rules_applied: result.rules_applied,
          total_findings: result.total_findings,
          errors: result.errors,
          warnings: result.warnings,
          infos: result.infos,
          run_id: result.run_id,
        };
      } catch {
        // No rules configured — that's ok, skip validation
        return { rules_applied: 0, total_findings: 0, errors: 0, warnings: 0, infos: 0, skipped: true };
      }
    });

    results.sentinel = sentinelResult;

    // ─── Step 4: Pathfinder Investigation ──────────────────────────────
    const pathfinderResult = await step.run("pathfinder-investigate", async () => {
      const admin = createAdminClient();

      await updatePipeline(pipeline_run_id, {
        status: "investigating",
        current_step: "Pathfinder is scanning for anomalies...",
        steps_completed: 4,
      });

      // Detect which metrics are available
      const { data: sampleRecords } = await admin
        .from("analyst_records")
        .select("metric_name, normalized_values")
        .eq("dataset_id", dataset_id)
        .limit(20);

      const metricNames = new Set<string>();
      for (const r of sampleRecords ?? []) {
        if (r.metric_name) metricNames.add(r.metric_name);
        // Also check numeric fields in normalized_values
        const nv = r.normalized_values as Record<string, unknown>;
        for (const [key, val] of Object.entries(nv)) {
          if (typeof val === "number" || (val !== null && !isNaN(Number(val)))) {
            metricNames.add(key);
          }
        }
      }

      let totalAnomalies = 0;
      const scannedMetrics: string[] = [];

      // Scan each metric for anomalies
      for (const metric of metricNames) {
        try {
          const result = await detectAnomalies(admin, owner_id, dataset_id, metric, 2);
          totalAnomalies += result.stats.anomaly_count;
          scannedMetrics.push(metric);
        } catch {
          // Skip metrics that fail (not enough data points, etc.)
        }
      }

      return { metrics_scanned: scannedMetrics.length, total_anomalies: totalAnomalies, metrics: scannedMetrics };
    });

    results.pathfinder = pathfinderResult;

    // ─── Step 5: Brief Compilation ─────────────────────────────────────
    const briefResult = await step.run("brief-compile", async () => {
      const admin = createAdminClient();

      await updatePipeline(pipeline_run_id, {
        status: "compiling",
        current_step: "Brief is compiling your report...",
        steps_completed: 5,
      });

      // Get dataset name for the report title
      const { data: dataset } = await admin
        .from("analyst_datasets")
        .select("name, period")
        .eq("id", dataset_id)
        .single();

      const title = dataset ? `${dataset.name} — ${dataset.period}` : "Pipeline Report";

      try {
        const report = await compileReport(
          admin,
          owner_id,
          [dataset_id],
          title,
          template_id ?? undefined,
          {
            sections: ["executive_summary", "metrics", "breakdown", "recommendations"],
          }
        );

        return {
          title: report.title,
          section_count: report.sections.length,
          template_used: report.template_id !== null,
        };
      } catch {
        return { skipped: true, reason: "No data available for compilation" };
      }
    });

    results.brief = briefResult;

    // ─── Finalize ──────────────────────────────────────────────────────
    await step.run("finalize", async () => {
      const admin = createAdminClient();

      await admin
        .from("analyst_datasets")
        .update({ status: "ready", processed_at: new Date().toISOString() })
        .eq("id", dataset_id);

      await updatePipeline(pipeline_run_id, {
        status: "completed",
        current_step: "Pipeline complete",
        steps_completed: 6,
        results,
        completed_at: new Date().toISOString(),
      });
    });

    return { pipeline_run_id, dataset_id, results };
  }
);
