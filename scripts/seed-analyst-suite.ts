/**
 * Seed Analyst Suite agent and sub-agents (Rosetta, Sentinel, Pathfinder, Brief).
 *
 * Usage:
 *   npx tsx scripts/seed-analyst-suite.ts
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   PLATFORM_OWNER_ID          — profile UUID that owns platform agents
 *   NEXT_PUBLIC_SITE_URL        — e.g. https://www.signalpot.dev
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerId = process.env.PLATFORM_OWNER_ID;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.signalpot.dev";

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!ownerId) {
  console.error("Missing PLATFORM_OWNER_ID — set to your profile UUID");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1. Upsert Analyst Suite parent agent
  const { data: suite, error: suiteErr } = await admin
    .from("agents")
    .upsert(
      {
        owner_id: ownerId,
        name: "Analyst Suite",
        slug: "analyst-suite",
        description:
          "Multi-source data normalization, validation, trend analysis, and reporting suite. Turns messy vendor data into clean, actionable insights.",
        listing_type: "suite",
        mcp_endpoint: `${siteUrl}/api/analyst/dispatch`,
        capability_schema: [],
        rate_type: "per_call",
        rate_amount: 0,
        rate_currency: "USD",
        auth_type: "none",
        tags: ["analytics", "normalization", "validation", "trends", "reporting", "platform"],
        status: "active",
        visibility: "public",
        goal: "Transform raw multi-source data into normalized, validated, analysis-ready datasets with automated anomaly detection and presentation-ready output.",
        decision_logic:
          "Routes requests to sub-agents based on capability: normalization → Rosetta, validation → Sentinel, investigation → Pathfinder, presentation → Brief.",
        agent_type: "hybrid",
      },
      { onConflict: "slug" }
    )
    .select("id, slug")
    .single();

  if (suiteErr) {
    console.error("Failed to upsert Analyst Suite:", suiteErr.message);
    process.exit(1);
  }

  console.log(`Analyst Suite: ${suite.id} (${suite.slug})`);

  // 2. Upsert Rosetta sub-agent (Normalizer)
  const { data: rosetta, error: rosettaErr } = await admin
    .from("agents")
    .upsert(
      {
        owner_id: ownerId,
        name: "Rosetta",
        slug: "analyst-rosetta",
        description:
          "Entity resolution and data normalization engine. Maps variant names across sources to a canonical taxonomy with configurable dimensions.",
        listing_type: "standard",
        parent_agent_id: suite.id,
        mcp_endpoint: null,
        capability_schema: [
          {
            name: "normalize.map",
            description:
              "Apply source column/dimension mappings to raw data",
            inputSchema: {
              type: "object",
              properties: {
                dataset_id: {
                  type: "string",
                  description: "ID of the dataset to map",
                },
                source_id: {
                  type: "string",
                  description: "ID of the source configuration to apply",
                },
              },
              required: ["dataset_id", "source_id"],
            },
            outputSchema: {
              type: "object",
              properties: {
                mapped_count: { type: "number" },
                unmapped: { type: "array", items: { type: "string" } },
              },
            },
          },
          {
            name: "normalize.resolve",
            description:
              "Resolve unmapped entities using fast-pass + smart-pass",
            inputSchema: {
              type: "object",
              properties: {
                dataset_id: {
                  type: "string",
                  description: "ID of the dataset containing unmapped entities",
                },
                dimension: {
                  type: "string",
                  description: "Dimension to resolve entities within",
                },
                candidates: {
                  type: "array",
                  items: { type: "string" },
                  description: "List of unresolved entity names",
                },
              },
              required: ["dataset_id", "dimension", "candidates"],
            },
            outputSchema: {
              type: "object",
              properties: {
                resolved: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      alias: { type: "string" },
                      entity_id: { type: "string" },
                      confidence: { type: "string" },
                    },
                  },
                },
                unresolved: { type: "array", items: { type: "string" } },
              },
            },
          },
          {
            name: "normalize.learn",
            description:
              "Record a user correction for future matching",
            inputSchema: {
              type: "object",
              properties: {
                alias: {
                  type: "string",
                  description: "The variant name to record",
                },
                entity_id: {
                  type: "string",
                  description: "Canonical entity ID this alias maps to",
                },
                source_id: {
                  type: "string",
                  description: "Optional source ID to scope the correction",
                },
                dimension: {
                  type: "string",
                  description: "Dimension this correction applies to",
                },
              },
              required: ["alias", "entity_id", "dimension"],
            },
            outputSchema: {
              type: "object",
              properties: {
                saved: { type: "boolean" },
              },
            },
          },
        ],
        rate_type: "per_call",
        rate_amount: 0,
        rate_currency: "USD",
        auth_type: "none",
        tags: ["normalization", "entity-resolution", "taxonomy", "mapping"],
        status: "active",
        visibility: "public",
        goal: "Resolve entity variants across multiple data sources into a single canonical taxonomy, learning from corrections over time.",
        decision_logic:
          "normalize.map: applies column and dimension mappings from source config. normalize.resolve: uses fast-pass (algorithmic) then smart-pass (LLM) to match unknown entities. normalize.learn: records user corrections to improve future matching.",
        agent_type: "reactive",
      },
      { onConflict: "slug" }
    )
    .select("id, slug, parent_agent_id")
    .single();

  if (rosettaErr) {
    console.error("Failed to upsert Rosetta:", rosettaErr.message);
    process.exit(1);
  }

  console.log(
    `Rosetta sub-agent: ${rosetta.id} (${rosetta.slug}) -> parent ${rosetta.parent_agent_id}`
  );

  // 3. Upsert Sentinel sub-agent (Validator)
  const { data: sentinel, error: sentinelErr } = await admin
    .from("agents")
    .upsert(
      {
        owner_id: ownerId,
        name: "Sentinel",
        slug: "analyst-sentinel",
        description:
          "Data validation engine. Checks normalized data against configurable rules and historical patterns to flag anomalies.",
        listing_type: "standard",
        parent_agent_id: suite.id,
        mcp_endpoint: null,
        capability_schema: [
          {
            name: "validate.run",
            description:
              "Run all active validation rules against a dataset",
            inputSchema: {
              type: "object",
              properties: {
                dataset_id: {
                  type: "string",
                  description: "ID of the dataset to validate",
                },
              },
              required: ["dataset_id"],
            },
            outputSchema: {
              type: "object",
              properties: {
                total_checks: { type: "number" },
                errors: { type: "number" },
                warnings: { type: "number" },
                flags: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      rule: { type: "string" },
                      severity: { type: "string" },
                      message: { type: "string" },
                      records: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
          {
            name: "validate.check",
            description:
              "Run a single validation rule",
            inputSchema: {
              type: "object",
              properties: {
                dataset_id: {
                  type: "string",
                  description: "ID of the dataset to check",
                },
                rule_id: {
                  type: "string",
                  description: "ID of the validation rule to run",
                },
              },
              required: ["dataset_id", "rule_id"],
            },
            outputSchema: {
              type: "object",
              properties: {
                passed: { type: "boolean" },
                flags: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      severity: { type: "string" },
                      message: { type: "string" },
                      record_id: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          {
            name: "validate.history",
            description:
              "Compare dataset against historical baselines",
            inputSchema: {
              type: "object",
              properties: {
                dataset_id: {
                  type: "string",
                  description: "ID of the dataset to compare",
                },
                metric: {
                  type: "string",
                  description: "Metric to compare against historical values",
                },
                threshold_pct: {
                  type: "number",
                  description: "Percentage threshold for flagging deviations",
                },
              },
              required: ["dataset_id", "metric"],
            },
            outputSchema: {
              type: "object",
              properties: {
                deviations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      entity: { type: "string" },
                      dimension: { type: "string" },
                      expected: { type: "number" },
                      actual: { type: "number" },
                      pct_change: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        ],
        rate_type: "per_call",
        rate_amount: 0,
        rate_currency: "USD",
        auth_type: "none",
        tags: ["validation", "anomaly-detection", "data-quality"],
        status: "active",
        visibility: "public",
        goal: "Ensure data quality by running validation rules against normalized datasets and flagging values that fall outside expected patterns.",
        decision_logic:
          "validate.run: executes all active rules against a dataset. validate.check: runs a single rule. validate.history: compares current values against historical baselines to detect trend deviations.",
        agent_type: "reactive",
      },
      { onConflict: "slug" }
    )
    .select("id, slug, parent_agent_id")
    .single();

  if (sentinelErr) {
    console.error("Failed to upsert Sentinel:", sentinelErr.message);
    process.exit(1);
  }

  console.log(
    `Sentinel sub-agent: ${sentinel.id} (${sentinel.slug}) -> parent ${sentinel.parent_agent_id}`
  );

  // 4. Upsert Pathfinder sub-agent (Investigator)
  const { data: pathfinder, error: pathfinderErr } = await admin
    .from("agents")
    .upsert(
      {
        owner_id: ownerId,
        name: "Pathfinder",
        slug: "analyst-pathfinder",
        description:
          "Automated anomaly investigation. Traverses dimensions laterally and hierarchically to identify root causes of data shifts.",
        listing_type: "standard",
        parent_agent_id: suite.id,
        mcp_endpoint: null,
        capability_schema: [
          {
            name: "investigate.anomaly",
            description:
              "Investigate a flagged anomaly across all dimensions",
            inputSchema: {
              type: "object",
              properties: {
                dataset_id: {
                  type: "string",
                  description: "ID of the dataset to investigate",
                },
                metric: {
                  type: "string",
                  description: "Metric where the anomaly was detected",
                },
                entity_id: {
                  type: "string",
                  description: "Optional entity to scope the investigation",
                },
                dimension: {
                  type: "string",
                  description: "Optional dimension to start from",
                },
              },
              required: ["dataset_id", "metric"],
            },
            outputSchema: {
              type: "object",
              properties: {
                root_cause: { type: "string" },
                path: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      dimension: { type: "string" },
                      entity: { type: "string" },
                      contribution: { type: "number" },
                    },
                  },
                },
                confidence: { type: "string" },
              },
            },
          },
          {
            name: "investigate.explain",
            description:
              "Generate written explanation of an anomaly",
            inputSchema: {
              type: "object",
              properties: {
                anomaly: {
                  type: "object",
                  description: "The anomaly object to explain",
                },
                context: {
                  type: "string",
                  description: "Optional additional context for the explanation",
                },
              },
              required: ["anomaly"],
            },
            outputSchema: {
              type: "object",
              properties: {
                explanation: { type: "string" },
                supporting_data: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      value: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          {
            name: "investigate.drill",
            description:
              "Drill into a specific dimension",
            inputSchema: {
              type: "object",
              properties: {
                dataset_id: {
                  type: "string",
                  description: "ID of the dataset to drill into",
                },
                metric: {
                  type: "string",
                  description: "Metric to break down",
                },
                dimension: {
                  type: "string",
                  description: "Dimension to drill into",
                },
                entity_id: {
                  type: "string",
                  description: "Optional entity to scope the drill-down",
                },
              },
              required: ["dataset_id", "metric", "dimension"],
            },
            outputSchema: {
              type: "object",
              properties: {
                breakdown: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      entity: { type: "string" },
                      value: { type: "number" },
                      change_pct: { type: "number" },
                      trend: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        ],
        rate_type: "per_call",
        rate_amount: 0,
        rate_currency: "USD",
        auth_type: "none",
        tags: ["investigation", "root-cause", "anomaly", "drill-down"],
        status: "active",
        visibility: "public",
        goal: "When an anomaly is detected, automatically investigate across all dimensions to find the root cause — even when the signal appears at a different level than its source.",
        decision_logic:
          "investigate.anomaly: takes a flagged anomaly and checks all dimensions in parallel, following lateral signals. investigate.explain: generates a written explanation with supporting data. investigate.drill: explores a specific dimension path on demand.",
        agent_type: "hybrid",
      },
      { onConflict: "slug" }
    )
    .select("id, slug, parent_agent_id")
    .single();

  if (pathfinderErr) {
    console.error("Failed to upsert Pathfinder:", pathfinderErr.message);
    process.exit(1);
  }

  console.log(
    `Pathfinder sub-agent: ${pathfinder.id} (${pathfinder.slug}) -> parent ${pathfinder.parent_agent_id}`
  );

  // 5. Upsert Brief sub-agent (Compiler)
  const { data: brief, error: briefErr } = await admin
    .from("agents")
    .upsert(
      {
        owner_id: ownerId,
        name: "Brief",
        slug: "analyst-brief",
        description:
          "Presentation compiler. Transforms analysis outputs into formatted reports, slide-ready data, and chart configurations.",
        listing_type: "standard",
        parent_agent_id: suite.id,
        mcp_endpoint: null,
        capability_schema: [
          {
            name: "compile.report",
            description:
              "Generate a full analysis report",
            inputSchema: {
              type: "object",
              properties: {
                dataset_ids: {
                  type: "array",
                  items: { type: "string" },
                  description: "IDs of datasets to include in the report",
                },
                metrics: {
                  type: "array",
                  items: { type: "string" },
                  description: "Metrics to report on",
                },
                period: {
                  type: "string",
                  description: "Time period for the report",
                },
                template: {
                  type: "string",
                  description: "Optional report template name",
                },
              },
              required: ["dataset_ids", "metrics", "period"],
            },
            outputSchema: {
              type: "object",
              properties: {
                title: { type: "string" },
                sections: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      heading: { type: "string" },
                      body: { type: "string" },
                      data: { type: "object" },
                      chart: { type: "object" },
                    },
                  },
                },
              },
            },
          },
          {
            name: "compile.slide",
            description:
              "Format data for a presentation slide",
            inputSchema: {
              type: "object",
              properties: {
                data: {
                  type: "object",
                  description: "Data to format for the slide",
                },
                template: {
                  type: "string",
                  description: "Optional slide template name",
                },
                title: {
                  type: "string",
                  description: "Optional slide title",
                },
              },
              required: ["data"],
            },
            outputSchema: {
              type: "object",
              properties: {
                title: { type: "string" },
                bullets: { type: "array", items: { type: "string" } },
                table: { type: "object" },
                chart: { type: "object" },
                footnotes: { type: "array", items: { type: "string" } },
              },
            },
          },
          {
            name: "compile.table",
            description:
              "Produce formatted table data",
            inputSchema: {
              type: "object",
              properties: {
                dataset_id: {
                  type: "string",
                  description: "ID of the dataset to tabulate",
                },
                metrics: {
                  type: "array",
                  items: { type: "string" },
                  description: "Metrics to include as columns",
                },
                dimensions: {
                  type: "array",
                  items: { type: "string" },
                  description: "Dimensions to include as row groupings",
                },
                period: {
                  type: "string",
                  description: "Optional time period filter",
                },
              },
              required: ["dataset_id", "metrics", "dimensions"],
            },
            outputSchema: {
              type: "object",
              properties: {
                headers: { type: "array", items: { type: "string" } },
                rows: {
                  type: "array",
                  items: {
                    type: "array",
                    items: { type: ["string", "number"] },
                  },
                },
                totals: {
                  type: "array",
                  items: { type: ["string", "number"] },
                },
              },
            },
          },
          {
            name: "compile.chart",
            description:
              "Generate chart configuration",
            inputSchema: {
              type: "object",
              properties: {
                dataset_id: {
                  type: "string",
                  description: "ID of the dataset to chart",
                },
                metric: {
                  type: "string",
                  description: "Metric to plot",
                },
                dimension: {
                  type: "string",
                  description: "Dimension for the chart axis",
                },
                chart_type: {
                  type: "string",
                  description: "Optional chart type (bar, line, pie, etc.)",
                },
              },
              required: ["dataset_id", "metric", "dimension"],
            },
            outputSchema: {
              type: "object",
              properties: {
                type: { type: "string" },
                labels: { type: "array", items: { type: "string" } },
                datasets: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      data: { type: "array", items: { type: "number" } },
                    },
                  },
                },
                options: { type: "object" },
              },
            },
          },
        ],
        rate_type: "per_call",
        rate_amount: 0,
        rate_currency: "USD",
        auth_type: "none",
        tags: ["reporting", "presentation", "formatting", "output"],
        status: "active",
        visibility: "public",
        goal: "Take raw analysis outputs and compile them into presentation-ready formats matching configurable templates.",
        decision_logic:
          "compile.report: generates a full report from dataset analysis. compile.slide: formats data for a single presentation slide. compile.table: produces formatted Excel-ready table data. compile.chart: generates chart configuration with data.",
        agent_type: "reactive",
      },
      { onConflict: "slug" }
    )
    .select("id, slug, parent_agent_id")
    .single();

  if (briefErr) {
    console.error("Failed to upsert Brief:", briefErr.message);
    process.exit(1);
  }

  console.log(
    `Brief sub-agent: ${brief.id} (${brief.slug}) -> parent ${brief.parent_agent_id}`
  );
  console.log("Done.");
}

main();
