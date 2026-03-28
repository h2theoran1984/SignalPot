import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

/**
 * GET /api/analyst/datasets
 * List datasets for the authenticated user, with source name joined.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: datasets, error } = await admin
    .from("analyst_datasets")
    .select("id, source_id, name, period, row_count, status, uploaded_at, processed_at, analyst_sources(name)")
    .eq("owner_id", auth.profileId)
    .order("uploaded_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch datasets" },
      { status: 500 }
    );
  }

  // Flatten the joined source name
  const enriched = (datasets ?? []).map((d) => {
    const source = d.analyst_sources as unknown as { name: string } | null;
    return {
      id: d.id,
      source_id: d.source_id,
      source_name: source?.name ?? null,
      name: d.name,
      period: d.period,
      row_count: d.row_count,
      status: d.status,
      uploaded_at: d.uploaded_at,
    };
  });

  return NextResponse.json({ datasets: enriched });
}

const createDatasetSchema = z.object({
  source_id: z.string().uuid(),
  name: z.string().min(1).max(200).trim(),
  period: z.string().min(1).max(50).trim(),
});

/**
 * POST /api/analyst/datasets
 * Create a new dataset.
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

  const parsed = createDatasetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: dataset, error } = await admin
    .from("analyst_datasets")
    .insert({
      owner_id: auth.profileId,
      source_id: parsed.data.source_id,
      name: parsed.data.name,
      period: parsed.data.period,
    })
    .select("id, source_id, name, period, uploaded_at")
    .single();

  if (error) {
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Referenced source does not exist" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create dataset" },
      { status: 500 }
    );
  }

  return NextResponse.json({ dataset }, { status: 201 });
}
