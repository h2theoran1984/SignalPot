import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

/**
 * GET /api/analyst/sources
 * List all data sources for the authenticated user.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: sources, error } = await admin
    .from("analyst_sources")
    .select("id, name, slug, description, format_type, column_map, dimension_map, created_at, updated_at")
    .eq("owner_id", auth.profileId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch sources" },
      { status: 500 }
    );
  }

  return NextResponse.json({ sources: sources ?? [] });
}

const createSourceSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  slug: z.string().min(1).max(100).trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens"),
  description: z.string().max(1000).trim().optional(),
  format_type: z.enum(["csv", "json", "excel", "parquet", "api"]),
  column_map: z.record(z.string(), z.string()).optional(),
  dimension_map: z.record(z.string(), z.string()).optional(),
});

/**
 * POST /api/analyst/sources
 * Create a new data source.
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

  const parsed = createSourceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: source, error } = await admin
    .from("analyst_sources")
    .insert({
      owner_id: auth.profileId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description ?? null,
      format_type: parsed.data.format_type,
      column_map: parsed.data.column_map ?? null,
      dimension_map: parsed.data.dimension_map ?? null,
    })
    .select("id, name, slug, description, format_type, column_map, dimension_map, created_at")
    .single();

  if (error) {
    // Check for unique constraint violation on slug
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A source with that slug already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create source" },
      { status: 500 }
    );
  }

  return NextResponse.json({ source }, { status: 201 });
}
