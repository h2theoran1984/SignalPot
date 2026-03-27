/**
 * Sentinel Rule Executors — one function per rule_type.
 *
 * Each executor receives the rule config and an array of records,
 * then returns an array of findings (violations).
 */

export interface AnalystRecord {
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

export interface Finding {
  rule_id: string;
  rule_name: string;
  severity: "error" | "warning" | "info";
  field: string;
  message: string;
  record_ids: string[];
}

export interface RuleConfig {
  // required_field
  fields?: string[];

  // range_check
  field?: string;
  min?: number;
  max?: number;

  // cross_source
  compare_dataset_id?: string;
  match_key?: string;
  compare_field?: string;
  tolerance_pct?: number;

  // trend_deviation
  metric?: string;
  std_dev_threshold?: number;

  // custom
  expression?: string;

  [key: string]: unknown;
}

export interface ValidationRule {
  id: string;
  name: string;
  rule_type: string;
  dimension_id: string | null;
  config: RuleConfig;
  severity: "error" | "warning" | "info";
}

// ---------------------------------------------------------------------------
// required_field — checks that specified fields are non-null and non-empty
// ---------------------------------------------------------------------------

export function runRequiredField(
  rule: ValidationRule,
  records: AnalystRecord[]
): Finding[] {
  const fields = rule.config.fields ?? [];
  if (fields.length === 0) return [];

  const findings: Finding[] = [];

  for (const field of fields) {
    const violators = records.filter((r) => {
      const val = r.normalized_values[field] ?? r.raw_values[field];
      return val === null || val === undefined || val === "";
    });

    if (violators.length > 0) {
      findings.push({
        rule_id: rule.id,
        rule_name: rule.name,
        severity: rule.severity,
        field,
        message: `${violators.length} record(s) missing required field "${field}"`,
        record_ids: violators.map((r) => r.id),
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// range_check — checks that a numeric field falls within [min, max]
// ---------------------------------------------------------------------------

export function runRangeCheck(
  rule: ValidationRule,
  records: AnalystRecord[]
): Finding[] {
  const { field, min, max } = rule.config;
  if (!field) return [];

  const findings: Finding[] = [];
  const violators: string[] = [];
  const details: string[] = [];

  for (const r of records) {
    // Check normalized_values first, fall back to metric_value if the field matches metric_name
    let val: number | null = null;
    const nv = r.normalized_values[field];
    if (nv !== null && nv !== undefined) {
      val = Number(nv);
    } else if (r.metric_name === field && r.metric_value !== null) {
      val = r.metric_value;
    }

    if (val === null || isNaN(val)) continue;

    const belowMin = min !== undefined && val < min;
    const aboveMax = max !== undefined && val > max;

    if (belowMin || aboveMax) {
      violators.push(r.id);
      if (belowMin) details.push(`${val} < ${min}`);
      if (aboveMax) details.push(`${val} > ${max}`);
    }
  }

  if (violators.length > 0) {
    const rangeStr = `[${min ?? "-∞"}, ${max ?? "∞"}]`;
    findings.push({
      rule_id: rule.id,
      rule_name: rule.name,
      severity: rule.severity,
      field,
      message: `${violators.length} record(s) have "${field}" outside range ${rangeStr}`,
      record_ids: violators,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// cross_source — compares values between two datasets for consistency
// ---------------------------------------------------------------------------

export function runCrossSource(
  rule: ValidationRule,
  records: AnalystRecord[],
  compareRecords: AnalystRecord[]
): Finding[] {
  const { match_key, compare_field, tolerance_pct = 5 } = rule.config;
  if (!match_key || !compare_field) return [];

  // Build lookup from compare dataset: key -> value
  const compareLookup = new Map<string, number>();
  for (const cr of compareRecords) {
    const key = String(cr.normalized_values[match_key] ?? cr.raw_values[match_key] ?? "");
    const val = Number(cr.normalized_values[compare_field] ?? cr.raw_values[compare_field]);
    if (key && !isNaN(val)) {
      compareLookup.set(key, val);
    }
  }

  const findings: Finding[] = [];
  const violators: string[] = [];

  for (const r of records) {
    const key = String(r.normalized_values[match_key] ?? r.raw_values[match_key] ?? "");
    const val = Number(r.normalized_values[compare_field] ?? r.raw_values[compare_field]);
    if (!key || isNaN(val)) continue;

    const expected = compareLookup.get(key);
    if (expected === undefined) continue;

    const diff = Math.abs(val - expected);
    const pct = expected !== 0 ? (diff / Math.abs(expected)) * 100 : diff > 0 ? 100 : 0;

    if (pct > tolerance_pct) {
      violators.push(r.id);
    }
  }

  if (violators.length > 0) {
    findings.push({
      rule_id: rule.id,
      rule_name: rule.name,
      severity: rule.severity,
      field: compare_field,
      message: `${violators.length} record(s) diverge from comparison source by more than ${tolerance_pct}%`,
      record_ids: violators,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// trend_deviation — flags records where a metric deviates beyond N std devs
// ---------------------------------------------------------------------------

export function runTrendDeviation(
  rule: ValidationRule,
  records: AnalystRecord[]
): Finding[] {
  const { metric, std_dev_threshold = 2 } = rule.config;
  const field = metric ?? rule.config.field;
  if (!field) return [];

  // Collect numeric values
  const values: { id: string; val: number }[] = [];
  for (const r of records) {
    let val: number | null = null;
    const nv = r.normalized_values[field];
    if (nv !== null && nv !== undefined) {
      val = Number(nv);
    } else if (r.metric_name === field && r.metric_value !== null) {
      val = r.metric_value;
    }
    if (val !== null && !isNaN(val)) {
      values.push({ id: r.id, val });
    }
  }

  if (values.length < 3) return []; // need enough data points

  const mean = values.reduce((s, v) => s + v.val, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v.val - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return []; // no variance

  const violators = values
    .filter((v) => Math.abs(v.val - mean) > std_dev_threshold * stdDev)
    .map((v) => v.id);

  if (violators.length > 0) {
    return [
      {
        rule_id: rule.id,
        rule_name: rule.name,
        severity: rule.severity,
        field,
        message: `${violators.length} record(s) deviate more than ${std_dev_threshold} std deviations from the mean (mean=${mean.toFixed(2)}, σ=${stdDev.toFixed(2)})`,
        record_ids: violators,
      },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// custom — evaluates a simple expression against each record
// Supported: field comparisons like "unit_share > 100", "growth_rate != 0"
// ---------------------------------------------------------------------------

export function runCustom(
  rule: ValidationRule,
  records: AnalystRecord[]
): Finding[] {
  const { expression } = rule.config;
  if (!expression) return [];

  // Parse simple expressions: "field op value"
  const match = expression.match(
    /^(\w+)\s*(==|!=|>|<|>=|<=)\s*(.+)$/
  );
  if (!match) {
    return [
      {
        rule_id: rule.id,
        rule_name: rule.name,
        severity: "info",
        field: "expression",
        message: `Could not parse custom expression: "${expression}"`,
        record_ids: [],
      },
    ];
  }

  const [, field, op, rawVal] = match;
  const compareVal = rawVal.trim().replace(/^["']|["']$/g, "");
  const numericCompare = !isNaN(Number(compareVal));

  const violators: string[] = [];

  for (const r of records) {
    const raw = r.normalized_values[field] ?? r.raw_values[field];
    if (raw === null || raw === undefined) continue;

    let passes = false;
    if (numericCompare) {
      const n = Number(raw);
      const c = Number(compareVal);
      if (isNaN(n)) continue;
      switch (op) {
        case "==": passes = n === c; break;
        case "!=": passes = n !== c; break;
        case ">": passes = n > c; break;
        case "<": passes = n < c; break;
        case ">=": passes = n >= c; break;
        case "<=": passes = n <= c; break;
      }
    } else {
      const s = String(raw);
      switch (op) {
        case "==": passes = s === compareVal; break;
        case "!=": passes = s !== compareVal; break;
        default: passes = false;
      }
    }

    // The expression defines the violation condition — records that match it are flagged
    if (passes) {
      violators.push(r.id);
    }
  }

  if (violators.length > 0) {
    return [
      {
        rule_id: rule.id,
        rule_name: rule.name,
        severity: rule.severity,
        field,
        message: `${violators.length} record(s) match custom rule: ${expression}`,
        record_ids: violators,
      },
    ];
  }

  return [];
}
