import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import {
  compileReport,
  compileSlides,
  compileTable,
  compileChart,
} from "@/lib/analyst/brief/engine";

const compileSchema = z.discriminatedUnion("output_type", [
  z.object({
    output_type: z.literal("report"),
    dataset_ids: z.array(z.string().uuid()).min(1),
    title: z.string().min(1).max(200).trim(),
    template_id: z.string().uuid().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    output_type: z.literal("slide"),
    dataset_ids: z.array(z.string().uuid()).min(1),
    title: z.string().min(1).max(200).trim(),
    template_id: z.string().uuid().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    output_type: z.literal("table"),
    dataset_id: z.string().uuid(),
    dimensions: z.array(z.string().uuid()).min(1),
    metrics: z.array(z.string()).min(1),
    template_id: z.string().uuid().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    output_type: z.literal("chart"),
    dataset_id: z.string().uuid(),
    chart_type: z.enum(["bar", "line", "pie", "scatter", "heatmap"]),
    x: z.string().min(1),
    y: z.string().min(1),
    group_by: z.string().optional(),
    template_id: z.string().uuid().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
]);

/**
 * POST /api/analyst/compile
 * Run a Brief compilation. Supports template_id + inline params.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasScope(auth, "agents:write")) {
    return NextResponse.json({ error: "Forbidden — insufficient scope" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = compileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  try {
    switch (parsed.data.output_type) {
      case "report": {
        const result = await compileReport(
          admin,
          auth.profileId,
          parsed.data.dataset_ids,
          parsed.data.title,
          parsed.data.template_id,
          parsed.data.params ?? {}
        );
        return NextResponse.json(result);
      }

      case "slide": {
        const result = await compileSlides(
          admin,
          auth.profileId,
          parsed.data.dataset_ids,
          parsed.data.title,
          parsed.data.template_id,
          parsed.data.params ?? {}
        );
        return NextResponse.json(result);
      }

      case "table": {
        const result = await compileTable(
          admin,
          auth.profileId,
          parsed.data.dataset_id,
          parsed.data.dimensions,
          parsed.data.metrics,
          parsed.data.template_id,
          parsed.data.params ?? {}
        );
        return NextResponse.json(result);
      }

      case "chart": {
        const result = await compileChart(
          admin,
          auth.profileId,
          parsed.data.dataset_id,
          parsed.data.chart_type,
          parsed.data.x,
          parsed.data.y,
          parsed.data.group_by,
          parsed.data.template_id,
          parsed.data.params ?? {}
        );
        return NextResponse.json(result);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Compilation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
