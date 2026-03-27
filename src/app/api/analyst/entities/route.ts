import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

/**
 * GET /api/analyst/entities
 * List canonical entities for the authenticated user.
 * Optionally filter by dimension_id query param.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { searchParams } = new URL(request.url);
  const dimensionId = searchParams.get("dimension_id");

  let query = admin
    .from("analyst_entities")
    .select("id, dimension_id, canonical_name, parent_entity_id, metadata, created_at, updated_at")
    .eq("owner_id", auth.profileId)
    .order("canonical_name", { ascending: true });

  if (dimensionId) {
    query = query.eq("dimension_id", dimensionId);
  }

  const { data: entities, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch entities" },
      { status: 500 }
    );
  }

  return NextResponse.json({ entities: entities ?? [] });
}

const createEntitySchema = z.object({
  dimension_id: z.string().uuid(),
  canonical_name: z.string().min(1).max(500).trim(),
  parent_entity_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * POST /api/analyst/entities
 * Create a new canonical entity.
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

  const parsed = createEntitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: entity, error } = await admin
    .from("analyst_entities")
    .insert({
      owner_id: auth.profileId,
      dimension_id: parsed.data.dimension_id,
      canonical_name: parsed.data.canonical_name,
      parent_entity_id: parsed.data.parent_entity_id ?? null,
      metadata: parsed.data.metadata ?? null,
    })
    .select("id, dimension_id, canonical_name, parent_entity_id, metadata, created_at")
    .single();

  if (error) {
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Referenced dimension or parent entity does not exist" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create entity" },
      { status: 500 }
    );
  }

  return NextResponse.json({ entity }, { status: 201 });
}
