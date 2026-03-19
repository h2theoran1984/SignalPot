import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSecret, storeSecret } from "@/lib/keykeeper/vault";
import { getProvider } from "@/lib/keykeeper/providers";
import { notify } from "@/lib/notifications";
import { z } from "zod";

/**
 * GET /api/keykeeper/secrets
 * List all secrets for the authenticated user (names, providers, status — never values).
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: secrets, error } = await admin
    .from("keykeeper_secrets")
    .select("name, provider, rotation_days, last_rotated_at, created_at")
    .eq("owner_id", auth.profileId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch secrets" },
      { status: 500 }
    );
  }

  const now = Date.now();

  const enriched = (secrets ?? []).map((s) => {
    const createdAt = new Date(s.created_at).getTime();
    const lastRotated = new Date(s.last_rotated_at).getTime();
    const ageDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
    const daysSinceRotation = Math.floor(
      (now - lastRotated) / (1000 * 60 * 60 * 24)
    );
    const daysUntilDue = s.rotation_days - daysSinceRotation;

    let status: "healthy" | "due" | "overdue";
    if (daysUntilDue < 0) {
      status = "overdue";
    } else if (daysUntilDue <= 7) {
      status = "due";
    } else {
      status = "healthy";
    }

    return {
      name: s.name,
      provider: s.provider,
      rotation_days: s.rotation_days,
      age_days: ageDays,
      days_since_rotation: daysSinceRotation,
      days_until_due: Math.max(0, daysUntilDue),
      last_rotated_at: s.last_rotated_at,
      created_at: s.created_at,
      status,
    };
  });

  return NextResponse.json({ secrets: enriched });
}

const rotateSchema = z.object({
  action: z.literal("rotate"),
  secret_name: z.string().min(1).max(128),
});

/**
 * POST /api/keykeeper/secrets
 * Trigger manual rotation for a specific secret.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = rotateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { secret_name } = parsed.data;

  // Verify the secret belongs to this user
  const { data: secret } = await admin
    .from("keykeeper_secrets")
    .select("name, provider, rotation_days")
    .eq("owner_id", auth.profileId)
    .eq("name", secret_name)
    .single();

  if (!secret) {
    return NextResponse.json({ error: "Secret not found" }, { status: 404 });
  }

  const provider = getProvider(secret.provider);

  if (!provider.supported) {
    // Generate OTU intake URL for manual rotation
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

    const { data: token } = await admin
      .from("keykeeper_intake_tokens")
      .insert({
        owner_id: auth.profileId,
        secret_name: secret.name,
        provider: secret.provider,
        expires_at: expiresAt.toISOString(),
      })
      .select("token")
      .single();

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.signalpot.dev";
    const intakeUrl = token
      ? `${siteUrl}/api/keykeeper/intake/${token.token}`
      : null;

    await notify(
      admin,
      auth.profileId,
      "rotation_due",
      "Manual rotation requested",
      `You requested rotation for your ${secret.provider} key '${secret.name}'. Use the secure link to submit your new key.`,
      { secret_name: secret.name, provider: secret.provider }
    );

    return NextResponse.json({
      success: true,
      message: `${secret.provider} doesn't support auto-rotation. Use the magic link to submit your new key.`,
      intake_url: intakeUrl,
    });
  }

  // Auto-rotate supported provider
  const adminCreds = await readSecret(
    admin,
    auth.profileId,
    `_admin:${secret.provider}`
  );

  if (!adminCreds) {
    return NextResponse.json(
      {
        error: `Auto-rotation requires admin credentials for ${secret.provider}. Store a key named '_admin:${secret.provider}' first.`,
      },
      { status: 400 }
    );
  }

  try {
    const result = await provider.rotate(adminCreds);
    const isValid = await provider.verify(result.newKey);

    if (!isValid) {
      return NextResponse.json(
        { error: "New key failed verification. Old key is still active." },
        { status: 500 }
      );
    }

    await storeSecret(
      admin,
      auth.profileId,
      secret.name,
      result.newKey,
      secret.provider as "openai" | "stripe" | "github" | "other"
    );

    await admin
      .from("keykeeper_secrets")
      .update({ last_rotated_at: new Date().toISOString() })
      .eq("owner_id", auth.profileId)
      .eq("name", secret.name);

    await notify(
      admin,
      auth.profileId,
      "rotation_complete",
      "Credential rotated",
      `Your ${secret.provider} key '${secret.name}' has been rotated successfully. The new key is active and verified.`,
      { secret_name: secret.name, provider: secret.provider }
    );

    return NextResponse.json({
      success: true,
      message: `${secret.name} rotated successfully. New key is active and verified.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[keykeeper/secrets] Rotation failed for ${secret.name}: ${message}`
    );

    return NextResponse.json(
      { error: "Rotation failed. Your current key is still active." },
      { status: 500 }
    );
  }
}
