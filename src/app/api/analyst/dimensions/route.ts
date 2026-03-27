import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

/**
 * GET /api/analyst/dimensions
 * List all dimensions for the authenticated user.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: dimensions, error } = await admin
    .from("analyst_dimensions")
    .select("id, name, slug, description, parent_dimension_id, sort_order, created_at, updated_at")
    .eq("owner_id", auth.profileId)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch dimensions" },
      { status: 500 }
    );
  }

  return NextResponse.json({ dimensions: dimensions ?? [] });
}

const createDimensionSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  slug: z.string().min(1).max(100).trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens"),
  description: z.string().max(1000).trim().optional(),
  parent_dimension_id: z.string().uuid().optional(),
  sort_order: z.number().int().min(0).optional().default(0),
});

/**
 * POST /api/analyst/dimensions
 * Create a new dimension.
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

  const parsed = createDimensionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: dimension, error } = await admin
    .from("analyst_dimensions")
    .insert({
      owner_id: auth.profileId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description ?? null,
      parent_dimension_id: parsed.data.parent_dimension_id ?? null,
      sort_order: parsed.data.sort_order,
    })
    .select("id, name, slug, description, parent_dimension_id, sort_order, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A dimension with that slug already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create dimension" },
      { status: 500 }
    );
  }

  return NextResponse.json({ dimension }, { status: 201 });
}
