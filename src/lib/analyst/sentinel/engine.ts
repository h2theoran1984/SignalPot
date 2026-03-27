/**
 * Sentinel Engine — orchestrates validation runs against datasets.
 *
 * Pipeline: Load rules -> Load records -> Execute rules -> Save findings -> Update dataset
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  type AnalystRecord,
  type Finding,
  type ValidationRule,
  runRequiredField,
  runRangeCheck,
  runCrossSource,
  runTrendDeviation,
  runCustom,
} from "./rules";

export interface ValidationRunResult {
  run_id: string;
  dataset_id: string;
  status: "completed" | "failed";
  rules_applied: number;
  total_findings: number;
  errors: number;
  warnings: number;
  infos: number;
  findings: Finding[];
  summary: Record<string, unknown>;
}

/**
 * Run all active validation rules against a dataset.
 */
export async function runValidation(
  admin: SupabaseClient,
  ownerId: string,
  datasetId: string,
  ruleFilter?: string[] // optional: only run specific rule IDs
): Promise<ValidationRunResult> {
  // 1. Create the validation run record
  const { data: run, error: runError } = await admin
    .from("analyst_validation_runs")
    .insert({
      dataset_id: datasetId,
      owner_id: ownerId,
      status: "running",
    })
    .select("id")
    .single();

  if (runError || !run) {
    throw new Error(`Failed to create validation run: ${runError?.message}`);
  }

  try {
    // 2. Load active rules for this owner
    let rulesQuery = admin
      .from("analyst_validation_rules")
      .select("id, name, rule_type, dimension_id, config, severity")
      .eq("owner_id", ownerId)
      .eq("active", true);

    if (ruleFilter && ruleFilter.length > 0) {
      rulesQuery = rulesQuery.in("id", ruleFilter);
    }

    const { data: rules, error: rulesError } = await rulesQuery;

    if (rulesError) {
      throw new Error(`Failed to load rules: ${rulesError.message}`);
    }

    const activeRules = (rules ?? []) as ValidationRule[];

    // 3. Load all records for this dataset
    const { data: rawRecords, error: recordsError } = await admin
      .from("analyst_records")
      .select("id, dataset_id, entity_mappings, raw_values, normalized_values, period, metric_name, metric_value, flags")
      .eq("dataset_id", datasetId);

    if (recordsError) {
      throw new Error(`Failed to load records: ${recordsError.message}`);
    }

    const records = (rawRecords ?? []) as AnalystRecord[];

    // 4. Execute each rule
    const allFindings: Finding[] = [];

    for (const rule of activeRules) {
      let ruleFindings: Finding[] = [];

      switch (rule.rule_type) {
        case "required_field":
          ruleFindings = runRequiredField(rule, records);
          break;

        case "range_check":
          ruleFindings = runRangeCheck(rule, records);
          break;

        case "cross_source": {
          const compareDatasetId = rule.config.compare_dataset_id;
          if (compareDatasetId) {
            const { data: compareRaw } = await admin
              .from("analyst_records")
              .select("id, dataset_id, entity_mappings, raw_values, normalized_values, period, metric_name, metric_value, flags")
              .eq("dataset_id", compareDatasetId);
            ruleFindings = runCrossSource(rule, records, (compareRaw ?? []) as AnalystRecord[]);
          }
          break;
        }

        case "trend_deviation":
          ruleFindings = runTrendDeviation(rule, records);
          break;

        case "custom":
          ruleFindings = runCustom(rule, records);
          break;
      }

      allFindings.push(...ruleFindings);
    }

    // 5. Aggregate counts
    const errors = allFindings.filter((f) => f.severity === "error").length;
    const warnings = allFindings.filter((f) => f.severity === "warning").length;
    const infos = allFindings.filter((f) => f.severity === "info").length;

    // 6. Write flags back to individual records
    const recordFlags = new Map<string, Finding[]>();
    for (const finding of allFindings) {
      for (const recordId of finding.record_ids) {
        const arr = recordFlags.get(recordId) ?? [];
        arr.push(finding);
        recordFlags.set(recordId, arr);
      }
    }

    // Batch update records with flags (up to 500 at a time)
    const flagEntries = Array.from(recordFlags.entries());
    for (let i = 0; i < flagEntries.length; i += 500) {
      const batch = flagEntries.slice(i, i + 500);
      await Promise.all(
        batch.map(([recordId, flags]) =>
          admin
            .from("analyst_records")
            .update({
              flags: flags.map((f) => ({
                rule_id: f.rule_id,
                rule_name: f.rule_name,
                severity: f.severity,
                field: f.field,
                message: f.message,
              })),
            })
            .eq("id", recordId)
        )
      );
    }

    // 7. Build summary
    const summary = {
      record_count: records.length,
      rules_applied: activeRules.length,
      flagged_records: recordFlags.size,
      clean_records: records.length - recordFlags.size,
      by_severity: { errors, warnings, infos },
      by_rule: activeRules.map((r) => ({
        rule_id: r.id,
        rule_name: r.name,
        rule_type: r.rule_type,
        finding_count: allFindings.filter((f) => f.rule_id === r.id).length,
      })),
    };

    // 8. Update the run record
    await admin
      .from("analyst_validation_runs")
      .update({
        status: "completed",
        rules_applied: activeRules.length,
        total_findings: allFindings.length,
        errors,
        warnings,
        infos,
        findings: allFindings,
        summary,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    // 9. Update dataset status and validation_summary
    await admin
      .from("analyst_datasets")
      .update({
        status: "validated",
        validation_summary: summary,
        processed_at: new Date().toISOString(),
      })
      .eq("id", datasetId);

    return {
      run_id: run.id,
      dataset_id: datasetId,
      status: "completed",
      rules_applied: activeRules.length,
      total_findings: allFindings.length,
      errors,
      warnings,
      infos,
      findings: allFindings,
      summary,
    };
  } catch (err) {
    // Mark run as failed
    await admin
      .from("analyst_validation_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        summary: { error: err instanceof Error ? err.message : "Unknown error" },
      })
      .eq("id", run.id);

    throw err;
  }
}

/**
 * Get a specific validation run by ID.
 */
export async function getValidationRun(
  admin: SupabaseClient,
  ownerId: string,
  runId: string
): Promise<ValidationRunResult | null> {
  const { data, error } = await admin
    .from("analyst_validation_runs")
    .select("*")
    .eq("id", runId)
    .eq("owner_id", ownerId)
    .single();

  if (error || !data) return null;

  return {
    run_id: data.id,
    dataset_id: data.dataset_id,
    status: data.status,
    rules_applied: data.rules_applied,
    total_findings: data.total_findings,
    errors: data.errors,
    warnings: data.warnings,
    infos: data.infos,
    findings: data.findings ?? [],
    summary: data.summary ?? {},
  };
}

/**
 * Get validation run history for a dataset.
 */
export async function getValidationHistory(
  admin: SupabaseClient,
  ownerId: string,
  datasetId: string,
  limit: number = 20
): Promise<Array<{
  run_id: string;
  status: string;
  rules_applied: number;
  total_findings: number;
  errors: number;
  warnings: number;
  infos: number;
  started_at: string;
  completed_at: string | null;
}>> {
  const { data, error } = await admin
    .from("analyst_validation_runs")
    .select("id, status, rules_applied, total_findings, errors, warnings, infos, started_at, completed_at")
    .eq("dataset_id", datasetId)
    .eq("owner_id", ownerId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) return [];

  return (data ?? []).map((r) => ({
    run_id: r.id,
    status: r.status,
    rules_applied: r.rules_applied,
    total_findings: r.total_findings,
    errors: r.errors,
    warnings: r.warnings,
    infos: r.infos,
    started_at: r.started_at,
    completed_at: r.completed_at,
  }));
}
