import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

/**
 * GET /api/notifications
 * Returns notifications for the authenticated user.
 * Query params: ?unread_only=true&limit=20
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(auth, "jobs:read")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unread_only") === "true";
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") ?? "20", 10) || 20,
    100
  );

  const admin = createAdminClient();

  let query = admin
    .from("notifications")
    .select("id, type, title, message, metadata, read_at, created_at")
    .eq("owner_id", auth.profileId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.is("read_at", null);
  }

  const { data: notifications, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 }
    );
  }

  // Get unread count
  const { count } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", auth.profileId)
    .is("read_at", null);

  return NextResponse.json({
    notifications: notifications ?? [],
    unread_count: count ?? 0,
  });
}

const markReadSchema = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }),
  z.object({ all: z.literal(true) }),
]);

/**
 * PATCH /api/notifications
 * Mark notifications as read.
 * Body: { ids: ["..."] } or { all: true }
 */
export async function PATCH(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(auth, "jobs:read")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = markReadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  if ("all" in parsed.data) {
    await admin
      .from("notifications")
      .update({ read_at: now })
      .eq("owner_id", auth.profileId)
      .is("read_at", null);
  } else {
    await admin
      .from("notifications")
      .update({ read_at: now })
      .eq("owner_id", auth.profileId)
      .in("id", parsed.data.ids);
  }

  return NextResponse.json({ success: true });
}
