import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

/**
 * GET /api/analyst/validation-rules
 * List all validation rules for the authenticated user.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: rules, error } = await admin
    .from("analyst_validation_rules")
    .select("id, name, description, rule_type, dimension_id, config, severity, active, created_at")
    .eq("owner_id", auth.profileId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch validation rules" },
      { status: 500 }
    );
  }

  return NextResponse.json({ rules: rules ?? [] });
}

const createRuleSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  description: z.string().max(1000).trim().optional(),
  rule_type: z.enum(["required_field", "range_check", "cross_source", "trend_deviation", "custom"]),
  dimension_id: z.string().uuid().optional().nullable(),
  config: z.record(z.string(), z.unknown()),
  severity: z.enum(["error", "warning", "info"]).optional().default("warning"),
});

/**
 * POST /api/analyst/validation-rules
 * Create a new validation rule.
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

  const parsed = createRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: rule, error } = await admin
    .from("analyst_validation_rules")
    .insert({
      owner_id: auth.profileId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      rule_type: parsed.data.rule_type,
      dimension_id: parsed.data.dimension_id ?? null,
      config: parsed.data.config,
      severity: parsed.data.severity,
    })
    .select("id, name, description, rule_type, dimension_id, config, severity, active, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A rule with that name already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create validation rule" },
      { status: 500 }
    );
  }

  return NextResponse.json({ rule }, { status: 201 });
}

const updateRuleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(1000).trim().optional().nullable(),
  config: z.record(z.string(), z.unknown()).optional(),
  severity: z.enum(["error", "warning", "info"]).optional(),
  active: z.boolean().optional(),
});

/**
 * PATCH /api/analyst/validation-rules
 * Update an existing validation rule.
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

  const parsed = updateRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { id, ...updates } = parsed.data;
  const admin = createAdminClient();

  const { data: rule, error } = await admin
    .from("analyst_validation_rules")
    .update(updates)
    .eq("id", id)
    .eq("owner_id", auth.profileId)
    .select("id, name, description, rule_type, dimension_id, config, severity, active, created_at")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to update validation rule" },
      { status: 500 }
    );
  }

  if (!rule) {
    return NextResponse.json(
      { error: "Rule not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ rule });
}

/**
 * DELETE /api/analyst/validation-rules
 * Delete a validation rule by ID (passed as ?id=...).
 */
export async function DELETE(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasScope(auth, "agents:write")) {
    return NextResponse.json({ error: "Forbidden — insufficient scope" }, { status: 403 });
  }

  const ruleId = request.nextUrl.searchParams.get("id");
  if (!ruleId) {
    return NextResponse.json({ error: "Missing rule id" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from("analyst_validation_rules")
    .delete()
    .eq("id", ruleId)
    .eq("owner_id", auth.profileId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete validation rule" },
      { status: 500 }
    );
  }

  return NextResponse.json({ deleted: true });
}
