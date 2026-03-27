import { NextRequest, NextResponse } from "next/server";
import { checkDispatchRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveNames, learnAlias } from "@/lib/analyst/rosetta/engine";
import { runValidation, getValidationRun, getValidationHistory } from "@/lib/analyst/sentinel/engine";
import { detectAnomalies, explainAnomaly, drillDown } from "@/lib/analyst/pathfinder/engine";
import { compileReport, compileSlides, compileTable, compileChart } from "@/lib/analyst/brief/engine";
import { timingSafeEqual } from "crypto";
import { z } from "zod";

const INTERNAL_KEY = process.env.INTERNAL_DISPATCH_KEY;

/* ------------------------------------------------------------------ */
/*  Input schemas per capability                                      */
/* ------------------------------------------------------------------ */

// normalize.*
const normalizeMapSchema = z.object({
  dataset_id: z.string().uuid(),
  source_id: z.string().uuid(),
});

const normalizeResolveSchema = z.object({
  dataset_id: z.string().uuid().optional(),
  dimension_id: z.string().uuid(),
  candidates: z.array(z.string().min(1).max(500).trim()).min(1).max(500),
  skip_smart_pass: z.boolean().optional(),
});

const normalizeLearnSchema = z.object({
  alias: z.string().min(1).max(500).trim(),
  entity_id: z.string().uuid(),
  source_id: z.string().uuid().optional(),
  dimension_id: z.string().uuid(),
});

// validate.*
const validateRunSchema = z.object({
  dataset_id: z.string().uuid(),
  rules: z.array(z.string()).optional(),
});

const validateCheckSchema = z.object({
  dataset_id: z.string().uuid(),
  check_id: z.string().uuid(),
});

const validateHistorySchema = z.object({
  dataset_id: z.string().uuid(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

// investigate.*
const investigateAnomalySchema = z.object({
  dataset_id: z.string().uuid(),
  metric: z.string().min(1).max(200),
  threshold: z.number().optional(),
});

const investigateExplainSchema = z.object({
  dataset_id: z.string().uuid(),
  anomaly_id: z.string().uuid(),
});

const investigateDrillSchema = z.object({
  dataset_id: z.string().uuid(),
  dimension_id: z.string().uuid(),
  filters: z.record(z.string(), z.unknown()).optional(),
});

// compile.*
const compileReportSchema = z.object({
  dataset_ids: z.array(z.string().uuid()).min(1),
  title: z.string().min(1).max(200).trim(),
  sections: z.array(z.string()).optional(),
});

const compileSlideSchema = z.object({
  dataset_ids: z.array(z.string().uuid()).min(1),
  title: z.string().min(1).max(200).trim(),
  slide_count: z.number().int().min(1).max(50).optional().default(10),
});

const compileTableSchema = z.object({
  dataset_id: z.string().uuid(),
  dimensions: z.array(z.string().uuid()).min(1),
  metrics: z.array(z.string()).min(1),
});

const compileChartSchema = z.object({
  dataset_id: z.string().uuid(),
  chart_type: z.enum(["bar", "line", "pie", "scatter", "heatmap"]),
  x: z.string().min(1),
  y: z.string().min(1),
  group_by: z.string().optional(),
});

/* ------------------------------------------------------------------ */
/*  POST /api/analyst/dispatch                                        */
/*  Internal suite dispatch endpoint                                  */
/* ------------------------------------------------------------------ */
export async function POST(request: NextRequest) {
  // 0. Rate limit by IP
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",").pop()!.trim()
    : request.headers.get("x-real-ip") || "unknown";

  const rateCheck = await checkDispatchRateLimit(ip);
  if (!rateCheck.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 }
    );
  }

  // 1. Verify internal origin — fail-closed
  if (!INTERNAL_KEY) {
    return NextResponse.json(
      { error: "Internal dispatch not configured" },
      { status: 503 }
    );
  }

  const provided = request.headers.get("x-signalpot-internal") ?? "";
  const keyBuf = Buffer.from(INTERNAL_KEY);
  const providedBuf = Buffer.from(provided);
  if (keyBuf.length !== providedBuf.length || !timingSafeEqual(keyBuf, providedBuf)) {
    return NextResponse.json(
      { error: "Forbidden — internal endpoint" },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const capability = body.capability as string | undefined;
  const input = body.input as Record<string, unknown> | undefined;
  const jobId = body.job_id as string | undefined;

  if (!capability || !input) {
    return NextResponse.json(
      { error: "Missing capability or input" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // 2. Dispatch by capability
  switch (capability) {
    /* -------------------------------------------------------------- */
    /*  normalize.*                                                    */
    /* -------------------------------------------------------------- */
    case "normalize.map": {
      const parsed = normalizeMapSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }
      return NextResponse.json({
        status: "not_implemented",
        message: "Dataset mapping will be available in the next release",
      });
    }

    case "normalize.resolve": {
      const parsed = normalizeResolveSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      // Resolve owner_id from job_id
      let ownerId: string | null = null;
      if (jobId) {
        const { data: job } = await admin
          .from("jobs")
          .select("requester_profile_id")
          .eq("id", jobId)
          .single();
        ownerId = job?.requester_profile_id ?? null;
      }
      if (!ownerId) {
        return NextResponse.json(
          { error: "normalize.resolve requires an authenticated caller (job_id)" },
          { status: 401 }
        );
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;

      try {
        const result = await resolveNames(
          admin,
          ownerId,
          parsed.data.dimension_id,
          parsed.data.candidates,
          {
            apiKey,
            skipSmartPass: parsed.data.skip_smart_pass,
          }
        );
        return NextResponse.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Resolution failed";
        return NextResponse.json(
          { error: `normalize.resolve failed: ${message}` },
          { status: 500 }
        );
      }
    }

    case "normalize.learn": {
      const parsed = normalizeLearnSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      try {
        await learnAlias(
          admin,
          parsed.data.entity_id,
          parsed.data.alias,
          parsed.data.source_id ?? null,
          "user"
        );
        return NextResponse.json({ saved: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Learn failed";
        return NextResponse.json(
          { error: `normalize.learn failed: ${message}` },
          { status: 500 }
        );
      }
    }

    /* -------------------------------------------------------------- */
    /*  validate.*                                                     */
    /* -------------------------------------------------------------- */
    case "validate.run": {
      const parsed = validateRunSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      // Resolve owner from job_id
      let validateOwnerId: string | null = null;
      if (jobId) {
        const { data: job } = await admin
          .from("jobs")
          .select("requester_profile_id")
          .eq("id", jobId)
          .single();
        validateOwnerId = job?.requester_profile_id ?? null;
      }
      if (!validateOwnerId) {
        return NextResponse.json(
          { error: "validate.run requires an authenticated caller (job_id)" },
          { status: 401 }
        );
      }

      try {
        const result = await runValidation(
          admin,
          validateOwnerId,
          parsed.data.dataset_id,
          parsed.data.rules
        );
        return NextResponse.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Validation run failed";
        return NextResponse.json(
          { error: `validate.run failed: ${message}` },
          { status: 500 }
        );
      }
    }

    case "validate.check": {
      const parsed = validateCheckSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      let checkOwnerId: string | null = null;
      if (jobId) {
        const { data: job } = await admin
          .from("jobs")
          .select("requester_profile_id")
          .eq("id", jobId)
          .single();
        checkOwnerId = job?.requester_profile_id ?? null;
      }
      if (!checkOwnerId) {
        return NextResponse.json(
          { error: "validate.check requires an authenticated caller (job_id)" },
          { status: 401 }
        );
      }

      const runResult = await getValidationRun(admin, checkOwnerId, parsed.data.check_id);
      if (!runResult) {
        return NextResponse.json(
          { error: "Validation run not found" },
          { status: 404 }
        );
      }
      return NextResponse.json(runResult);
    }

    case "validate.history": {
      const parsed = validateHistorySchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      let historyOwnerId: string | null = null;
      if (jobId) {
        const { data: job } = await admin
          .from("jobs")
          .select("requester_profile_id")
          .eq("id", jobId)
          .single();
        historyOwnerId = job?.requester_profile_id ?? null;
      }
      if (!historyOwnerId) {
        return NextResponse.json(
          { error: "validate.history requires an authenticated caller (job_id)" },
          { status: 401 }
        );
      }

      const history = await getValidationHistory(
        admin,
        historyOwnerId,
        parsed.data.dataset_id,
        parsed.data.limit
      );
      return NextResponse.json({ history });
    }

    /* -------------------------------------------------------------- */
    /*  investigate.*                                                  */
    /* -------------------------------------------------------------- */
    case "investigate.anomaly": {
      const parsed = investigateAnomalySchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      let detectOwnerId: string | null = null;
      if (jobId) {
        const { data: job } = await admin
          .from("jobs")
          .select("requester_profile_id")
          .eq("id", jobId)
          .single();
        detectOwnerId = job?.requester_profile_id ?? null;
      }
      if (!detectOwnerId) {
        return NextResponse.json(
          { error: "investigate.anomaly requires an authenticated caller (job_id)" },
          { status: 401 }
        );
      }

      try {
        const result = await detectAnomalies(
          admin,
          detectOwnerId,
          parsed.data.dataset_id,
          parsed.data.metric,
          parsed.data.threshold
        );
        return NextResponse.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Anomaly detection failed";
        return NextResponse.json(
          { error: `investigate.anomaly failed: ${message}` },
          { status: 500 }
        );
      }
    }

    case "investigate.explain": {
      const parsed = investigateExplainSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      let explainOwnerId: string | null = null;
      if (jobId) {
        const { data: job } = await admin
          .from("jobs")
          .select("requester_profile_id")
          .eq("id", jobId)
          .single();
        explainOwnerId = job?.requester_profile_id ?? null;
      }
      if (!explainOwnerId) {
        return NextResponse.json(
          { error: "investigate.explain requires an authenticated caller (job_id)" },
          { status: 401 }
        );
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { error: "ANTHROPIC_API_KEY not configured" },
          { status: 503 }
        );
      }

      try {
        const result = await explainAnomaly(admin, explainOwnerId, parsed.data.anomaly_id, apiKey);
        return NextResponse.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Explanation failed";
        return NextResponse.json(
          { error: `investigate.explain failed: ${message}` },
          { status: 500 }
        );
      }
    }

    case "investigate.drill": {
      const parsed = investigateDrillSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      let drillOwnerId: string | null = null;
      if (jobId) {
        const { data: job } = await admin
          .from("jobs")
          .select("requester_profile_id")
          .eq("id", jobId)
          .single();
        drillOwnerId = job?.requester_profile_id ?? null;
      }
      if (!drillOwnerId) {
        return NextResponse.json(
          { error: "investigate.drill requires an authenticated caller (job_id)" },
          { status: 401 }
        );
      }

      try {
        const result = await drillDown(
          admin,
          drillOwnerId,
          parsed.data.dataset_id,
          parsed.data.dimension_id,
          parsed.data.filters as Record<string, unknown> | undefined
        );
        return NextResponse.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Drill-down failed";
        return NextResponse.json(
          { error: `investigate.drill failed: ${message}` },
          { status: 500 }
        );
      }
    }

    /* -------------------------------------------------------------- */
    /*  compile.*                                                      */
    /* -------------------------------------------------------------- */
    case "compile.report": {
      const parsed = compileReportSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      let reportOwnerId: string | null = null;
      if (jobId) {
        const { data: job } = await admin
          .from("jobs")
          .select("requester_profile_id")
          .eq("id", jobId)
          .single();
        reportOwnerId = job?.requester_profile_id ?? null;
      }
      if (!reportOwnerId) {
        return NextResponse.json(
          { error: "compile.report requires an authenticated caller (job_id)" },
          { status: 401 }
        );
      }

      try {
        const result = await compileReport(
          admin,
          reportOwnerId,
          parsed.data.dataset_ids,
          parsed.data.title,
          undefined, // template_id — use inline sections as params
          { sections: parsed.data.sections }
        );
        return NextResponse.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Report compilation failed";
        return NextResponse.json({ error: `compile.report failed: ${message}` }, { status: 500 });
      }
    }

    case "compile.slide": {
      const parsed = compileSlideSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      let slideOwnerId: string | null = null;
      if (jobId) {
        const { data: job } = await admin
          .from("jobs")
          .select("requester_profile_id")
          .eq("id", jobId)
          .single();
        slideOwnerId = job?.requester_profile_id ?? null;
      }
      if (!slideOwnerId) {
        return NextResponse.json(
          { error: "compile.slide requires an authenticated caller (job_id)" },
          { status: 401 }
        );
      }

      try {
        const result = await compileSlides(
          admin,
          slideOwnerId,
          parsed.data.dataset_ids,
          parsed.data.title,
          undefined,
          { slide_count: parsed.data.slide_count }
        );
        return NextResponse.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Slide compilation failed";
        return NextResponse.json({ error: `compile.slide failed: ${message}` }, { status: 500 });
      }
    }

    case "compile.table": {
      const parsed = compileTableSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      let tableOwnerId: string | null = null;
      if (jobId) {
        const { data: job } = await admin
          .from("jobs")
          .select("requester_profile_id")
          .eq("id", jobId)
          .single();
        tableOwnerId = job?.requester_profile_id ?? null;
      }
      if (!tableOwnerId) {
        return NextResponse.json(
          { error: "compile.table requires an authenticated caller (job_id)" },
          { status: 401 }
        );
      }

      try {
        const result = await compileTable(
          admin,
          tableOwnerId,
          parsed.data.dataset_id,
          parsed.data.dimensions,
          parsed.data.metrics
        );
        return NextResponse.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Table compilation failed";
        return NextResponse.json({ error: `compile.table failed: ${message}` }, { status: 500 });
      }
    }

    case "compile.chart": {
      const parsed = compileChartSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      let chartOwnerId: string | null = null;
      if (jobId) {
        const { data: job } = await admin
          .from("jobs")
          .select("requester_profile_id")
          .eq("id", jobId)
          .single();
        chartOwnerId = job?.requester_profile_id ?? null;
      }
      if (!chartOwnerId) {
        return NextResponse.json(
          { error: "compile.chart requires an authenticated caller (job_id)" },
          { status: 401 }
        );
      }

      try {
        const result = await compileChart(
          admin,
          chartOwnerId,
          parsed.data.dataset_id,
          parsed.data.chart_type,
          parsed.data.x,
          parsed.data.y,
          parsed.data.group_by
        );
        return NextResponse.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Chart compilation failed";
        return NextResponse.json({ error: `compile.chart failed: ${message}` }, { status: 500 });
      }
    }

    default:
      return NextResponse.json(
        { error: `Unknown capability: ${capability}` },
        { status: 400 }
      );
  }
}
