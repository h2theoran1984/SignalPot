import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

/**
 * GET /api/analyst/templates
 * List all templates for the authenticated user.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const outputType = request.nextUrl.searchParams.get("output_type");

  let query = admin()
    .from("analyst_templates")
    .select("id, name, description, output_type, params, active, created_at, updated_at")
    .eq("owner_id", auth.profileId)
    .order("created_at", { ascending: false });

  if (outputType) {
    query = query.eq("output_type", outputType);
  }

  const { data: templates, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
  }

  return NextResponse.json({ templates: templates ?? [] });
}

function admin() {
  return createAdminClient();
}

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  description: z.string().max(1000).trim().optional(),
  output_type: z.enum(["report", "slide", "table", "chart"]),
  params: z.record(z.string(), z.unknown()),
});

/**
 * POST /api/analyst/templates
 * Create a new template.
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

  const parsed = createTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { data: template, error } = await admin()
    .from("analyst_templates")
    .insert({
      owner_id: auth.profileId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      output_type: parsed.data.output_type,
      params: parsed.data.params,
    })
    .select("id, name, description, output_type, params, active, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A template with that name already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }

  return NextResponse.json({ template }, { status: 201 });
}

const updateTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(1000).trim().optional().nullable(),
  params: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional(),
});

/**
 * PATCH /api/analyst/templates
 * Update an existing template.
 */
export async function PATCH(request: NextRequest) {
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

  const parsed = updateTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { id, ...updates } = parsed.data;

  const { data: template, error } = await admin()
    .from("analyst_templates")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", auth.profileId)
    .select("id, name, description, output_type, params, active, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to update template" }, { status: 500 });
  }

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ template });
}

/**
 * DELETE /api/analyst/templates?id=...
 * Delete a template.
 */
export async function DELETE(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasScope(auth, "agents:write")) {
    return NextResponse.json({ error: "Forbidden — insufficient scope" }, { status: 403 });
  }

  const templateId = request.nextUrl.searchParams.get("id");
  if (!templateId) {
    return NextResponse.json({ error: "Missing template id" }, { status: 400 });
  }

  const { error } = await admin()
    .from("analyst_templates")
    .delete()
    .eq("id", templateId)
    .eq("owner_id", auth.profileId);

  if (error) {
    return NextResponse.json({ error: "Failed to delete template" }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
