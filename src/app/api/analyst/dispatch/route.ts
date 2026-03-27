import { NextRequest, NextResponse } from "next/server";
import { checkDispatchRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveNames, learnAlias } from "@/lib/analyst/rosetta/engine";
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
      return NextResponse.json({
        status: "not_implemented",
        capability,
        input: parsed.data,
      });
    }

    case "validate.check": {
      const parsed = validateCheckSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }
      return NextResponse.json({
        status: "not_implemented",
        capability,
        input: parsed.data,
      });
    }

    case "validate.history": {
      const parsed = validateHistorySchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }
      return NextResponse.json({
        status: "not_implemented",
        capability,
        input: parsed.data,
      });
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
      return NextResponse.json({
        status: "not_implemented",
        capability,
        input: parsed.data,
      });
    }

    case "investigate.explain": {
      const parsed = investigateExplainSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }
      return NextResponse.json({
        status: "not_implemented",
        capability,
        input: parsed.data,
      });
    }

    case "investigate.drill": {
      const parsed = investigateDrillSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }
      return NextResponse.json({
        status: "not_implemented",
        capability,
        input: parsed.data,
      });
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
      return NextResponse.json({
        status: "not_implemented",
        capability,
        input: parsed.data,
      });
    }

    case "compile.slide": {
      const parsed = compileSlideSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }
      return NextResponse.json({
        status: "not_implemented",
        capability,
        input: parsed.data,
      });
    }

    case "compile.table": {
      const parsed = compileTableSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }
      return NextResponse.json({
        status: "not_implemented",
        capability,
        input: parsed.data,
      });
    }

    case "compile.chart": {
      const parsed = compileChartSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }
      return NextResponse.json({
        status: "not_implemented",
        capability,
        input: parsed.data,
      });
    }

    default:
      return NextResponse.json(
        { error: `Unknown capability: ${capability}` },
        { status: 400 }
      );
  }
}
