import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { storeSecret } from "@/lib/keykeeper/vault";
import { checkIpRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const intakeSchema = z.object({
  value: z.string().min(1).max(10_000),
});

/**
 * POST /api/keykeeper/intake/[token]
 * Unauthenticated — accepts a secret value via one-time magic link token.
 * Encrypts and stores via vault, then invalidates the token.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Rate limit by IP to prevent brute-force token guessing
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",").pop()!.trim()
    : request.headers.get("x-real-ip") || "unknown";

  const rateCheck = await checkIpRateLimit(ip);
  if (!rateCheck.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 }
    );
  }

  // Validate token format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(token)) {
    return NextResponse.json(
      { error: "Invalid token" },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = intakeSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "A non-empty 'value' field is required" },
      { status: 400 }
    );
  }

  const { value } = result.data;
  const admin = createAdminClient();

  // Fetch token — check exists, not used, not expired
  const { data: intake, error: fetchError } = await admin
    .from("keykeeper_intake_tokens")
    .select("token, owner_id, secret_name, provider, expires_at, used_at")
    .eq("token", token)
    .single();

  if (fetchError || !intake) {
    return NextResponse.json(
      { error: "Token not found" },
      { status: 404 }
    );
  }

  if (intake.used_at) {
    return NextResponse.json(
      { error: "Token has already been used" },
      { status: 410 }
    );
  }

  if (new Date(intake.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "Token has expired" },
      { status: 410 }
    );
  }

  // Atomically mark token as used — prevents race conditions
  const { data: updated } = await admin
    .from("keykeeper_intake_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token)
    .is("used_at", null)
    .select("token");

  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: "Token was already consumed" },
      { status: 409 }
    );
  }

  // Encrypt and store the secret
  try {
    await storeSecret(
      admin,
      intake.owner_id,
      intake.secret_name,
      value,
      intake.provider as "openai" | "stripe" | "github" | "other"
    );
  } catch {
    // Roll back: unmark the token so the user can retry
    await admin
      .from("keykeeper_intake_tokens")
      .update({ used_at: null })
      .eq("token", token);

    return NextResponse.json(
      { error: "Failed to store secret" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
