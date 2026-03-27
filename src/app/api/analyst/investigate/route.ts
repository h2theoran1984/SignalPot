import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import {
  detectAnomalies,
  explainAnomaly,
  drillDown,
  getAnomaliesByDataset,
  updateAnomalyStatus,
} from "@/lib/analyst/pathfinder/engine";

/**
 * GET /api/analyst/investigate?dataset_id=...
 * List anomalies for a dataset.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const datasetId = request.nextUrl.searchParams.get("dataset_id");
  if (!datasetId) {
    return NextResponse.json({ error: "Missing dataset_id" }, { status: 400 });
  }

  const admin = createAdminClient();
  const anomalies = await getAnomaliesByDataset(admin, auth.profileId, datasetId);

  return NextResponse.json({ anomalies });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("detect"),
    dataset_id: z.string().uuid(),
    metric: z.string().min(1).max(200),
    threshold: z.number().optional().default(2),
  }),
  z.object({
    action: z.literal("explain"),
    anomaly_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("drill"),
    dataset_id: z.string().uuid(),
    dimension_id: z.string().uuid(),
    filters: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    action: z.literal("status"),
    anomaly_id: z.string().uuid(),
    status: z.enum(["open", "acknowledged", "resolved", "false_positive"]),
  }),
]);

/**
 * POST /api/analyst/investigate
 * Run an investigation action (detect, explain, drill, or update status).
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

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  switch (parsed.data.action) {
    case "detect": {
      try {
        const result = await detectAnomalies(
          admin,
          auth.profileId,
          parsed.data.dataset_id,
          parsed.data.metric,
          parsed.data.threshold
        );
        return NextResponse.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Detection failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    case "explain": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { error: "ANTHROPIC_API_KEY not configured — cannot generate explanations" },
          { status: 503 }
        );
      }

      try {
        const result = await explainAnomaly(
          admin,
          auth.profileId,
          parsed.data.anomaly_id,
          apiKey
        );
        return NextResponse.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Explanation failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    case "drill": {
      try {
        const result = await drillDown(
          admin,
          auth.profileId,
          parsed.data.dataset_id,
          parsed.data.dimension_id,
          parsed.data.filters
        );
        return NextResponse.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Drill-down failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    case "status": {
      const updated = await updateAnomalyStatus(
        admin,
        auth.profileId,
        parsed.data.anomaly_id,
        parsed.data.status
      );
      if (!updated) {
        return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
      }
      return NextResponse.json({ updated: true });
    }
  }
}
