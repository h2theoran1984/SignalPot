import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { runValidation, getValidationHistory } from "@/lib/analyst/sentinel/engine";

const runSchema = z.object({
  dataset_id: z.string().uuid(),
  rules: z.array(z.string().uuid()).optional(),
});

/**
 * POST /api/analyst/validation-run
 * Trigger a Sentinel validation run on a dataset.
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

  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Verify the dataset belongs to this user
  const { data: dataset } = await admin
    .from("analyst_datasets")
    .select("id")
    .eq("id", parsed.data.dataset_id)
    .eq("owner_id", auth.profileId)
    .single();

  if (!dataset) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  try {
    const result = await runValidation(
      admin,
      auth.profileId,
      parsed.data.dataset_id,
      parsed.data.rules
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Validation run failed";
    return NextResponse.json(
      { error: `Validation failed: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * GET /api/analyst/validation-run?dataset_id=...
 * Get validation run history for a dataset.
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
  const history = await getValidationHistory(admin, auth.profileId, datasetId);

  return NextResponse.json({ history });
}
