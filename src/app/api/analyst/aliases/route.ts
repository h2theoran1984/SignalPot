import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

/**
 * GET /api/analyst/aliases
 * List aliases for the authenticated user.
 * Optionally filter by entity_id or source_id query param.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { searchParams } = new URL(request.url);
  const entityId = searchParams.get("entity_id");
  const sourceId = searchParams.get("source_id");

  let query = admin
    .from("analyst_aliases")
    .select("id, entity_id, source_id, alias, confidence, matched_by, created_at, updated_at")
    .eq("owner_id", auth.profileId)
    .order("created_at", { ascending: false });

  if (entityId) {
    query = query.eq("entity_id", entityId);
  }

  if (sourceId) {
    query = query.eq("source_id", sourceId);
  }

  const { data: aliases, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch aliases" },
      { status: 500 }
    );
  }

  return NextResponse.json({ aliases: aliases ?? [] });
}

const createAliasSchema = z.object({
  entity_id: z.string().uuid(),
  source_id: z.string().uuid(),
  alias: z.string().min(1).max(500).trim(),
  confidence: z.number().min(0).max(1).optional().default(1),
  matched_by: z.enum(["exact", "fuzzy", "manual", "ml"]).optional().default("manual"),
});

/**
 * POST /api/analyst/aliases
 * Create a new alias mapping.
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

  const parsed = createAliasSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: alias, error } = await admin
    .from("analyst_aliases")
    .insert({
      owner_id: auth.profileId,
      entity_id: parsed.data.entity_id,
      source_id: parsed.data.source_id,
      alias: parsed.data.alias,
      confidence: parsed.data.confidence,
      matched_by: parsed.data.matched_by,
    })
    .select("id, entity_id, source_id, alias, confidence, matched_by, created_at")
    .single();

  if (error) {
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Referenced entity or source does not exist" },
        { status: 400 }
      );
    }
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "This alias already exists for the given entity and source" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create alias" },
      { status: 500 }
    );
  }

  return NextResponse.json({ alias }, { status: 201 });
}
