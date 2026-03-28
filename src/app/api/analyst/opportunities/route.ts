import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { scanOpportunities, getOpportunities, updateOpportunityStatus } from "@/lib/analyst/radar/engine";

const scanSchema = z.object({
  action: z.literal("scan"),
  dataset_id: z.string().uuid(),
  account_dimension: z.string().min(1).max(100),
  product_dimension: z.string().min(1).max(100),
});

const statusSchema = z.object({
  action: z.literal("status"),
  opportunity_id: z.string().uuid(),
  status: z.enum(["open", "pursuing", "won", "dismissed"]),
});

const actionSchema = z.discriminatedUnion("action", [scanSchema, statusSchema]);

/**
 * GET /api/analyst/opportunities?dataset_id=...&type=...&priority=...
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const datasetId = request.nextUrl.searchParams.get("dataset_id");
  if (!datasetId) return NextResponse.json({ error: "Missing dataset_id" }, { status: 400 });

  const filters = {
    type: request.nextUrl.searchParams.get("type") ?? undefined,
    priority: request.nextUrl.searchParams.get("priority") ?? undefined,
    status: request.nextUrl.searchParams.get("status") ?? undefined,
  };

  const opportunities = await getOpportunities(admin, auth.profileId, datasetId, filters);
  return NextResponse.json({ opportunities });
}

/**
 * POST /api/analyst/opportunities
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasScope(auth, "agents:write")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 400 });

  const admin = createAdminClient();

  switch (parsed.data.action) {
    case "scan": {
      try {
        const result = await scanOpportunities(admin, auth.profileId, parsed.data.dataset_id, parsed.data.account_dimension, parsed.data.product_dimension);
        return NextResponse.json(result);
      } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : "Scan failed" }, { status: 500 });
      }
    }
    case "status": {
      const updated = await updateOpportunityStatus(admin, auth.profileId, parsed.data.opportunity_id, parsed.data.status);
      if (!updated) return NextResponse.json({ error: "Failed to update" }, { status: 500 });
      return NextResponse.json({ updated: true });
    }
  }
}
