import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { scanAccountHealth, checkAccountHealth, getHealthHistory } from "@/lib/analyst/pulse/engine";

const scanSchema = z.object({
  action: z.literal("scan"),
  dataset_id: z.string().uuid(),
  account_dimension: z.string().min(1).max(100),
});

const checkSchema = z.object({
  action: z.literal("check"),
  dataset_id: z.string().uuid(),
  entity_id: z.string().uuid(),
});

const historySchema = z.object({
  action: z.literal("history"),
  entity_id: z.string().uuid(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

const actionSchema = z.discriminatedUnion("action", [scanSchema, checkSchema, historySchema]);

/**
 * GET /api/analyst/account-health?dataset_id=...
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const datasetId = request.nextUrl.searchParams.get("dataset_id");

  if (!datasetId) {
    return NextResponse.json({ error: "Missing dataset_id" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("analyst_account_health")
    .select("*")
    .eq("owner_id", auth.profileId)
    .eq("dataset_id", datasetId)
    .order("health_score", { ascending: true });

  if (error) return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  return NextResponse.json({ accounts: data ?? [] });
}

/**
 * POST /api/analyst/account-health
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
        const result = await scanAccountHealth(admin, auth.profileId, parsed.data.dataset_id, parsed.data.account_dimension);
        return NextResponse.json(result);
      } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : "Scan failed" }, { status: 500 });
      }
    }
    case "check": {
      const result = await checkAccountHealth(admin, auth.profileId, parsed.data.dataset_id, parsed.data.entity_id);
      if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(result);
    }
    case "history": {
      const result = await getHealthHistory(admin, auth.profileId, parsed.data.entity_id, parsed.data.limit);
      return NextResponse.json({ history: result });
    }
  }
}
