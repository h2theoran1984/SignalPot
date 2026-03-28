import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { compileAccountReview, compileQBR, compileTerritoryPlan } from "@/lib/analyst/playbook/engine";

const compileSchema = z.discriminatedUnion("output_type", [
  z.object({
    output_type: z.literal("account_review"),
    dataset_id: z.string().uuid(),
    entity_id: z.string().uuid(),
    template_id: z.string().uuid().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    output_type: z.literal("qbr"),
    dataset_id: z.string().uuid(),
    title: z.string().min(1).max(200).trim(),
    template_id: z.string().uuid().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    output_type: z.literal("territory_plan"),
    dataset_id: z.string().uuid(),
    title: z.string().min(1).max(200).trim(),
    template_id: z.string().uuid().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
]);

/**
 * GET /api/analyst/playbook?output_type=...&dataset_id=...
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  let query = admin
    .from("analyst_playbook_outputs")
    .select("id, output_type, title, account_name, generated_at")
    .eq("owner_id", auth.profileId)
    .order("generated_at", { ascending: false })
    .limit(50);

  const outputType = request.nextUrl.searchParams.get("output_type");
  const datasetId = request.nextUrl.searchParams.get("dataset_id");
  if (outputType) query = query.eq("output_type", outputType);
  if (datasetId) query = query.eq("dataset_id", datasetId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  return NextResponse.json({ outputs: data ?? [] });
}

/**
 * POST /api/analyst/playbook
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasScope(auth, "agents:write")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = compileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 400 });

  const admin = createAdminClient();

  try {
    switch (parsed.data.output_type) {
      case "account_review": {
        const result = await compileAccountReview(admin, auth.profileId, parsed.data.dataset_id, parsed.data.entity_id, parsed.data.template_id, parsed.data.params ?? {});
        return NextResponse.json(result);
      }
      case "qbr": {
        const result = await compileQBR(admin, auth.profileId, parsed.data.dataset_id, parsed.data.title, parsed.data.template_id, parsed.data.params ?? {});
        return NextResponse.json(result);
      }
      case "territory_plan": {
        const result = await compileTerritoryPlan(admin, auth.profileId, parsed.data.dataset_id, parsed.data.title, parsed.data.template_id, parsed.data.params ?? {});
        return NextResponse.json(result);
      }
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Compilation failed" }, { status: 500 });
  }
}
