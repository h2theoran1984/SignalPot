import { NextResponse } from "next/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const generateSchema = z.object({
  secret_name: z.string().min(1).max(100).trim(),
  provider: z.enum(["openai", "stripe", "github", "other"]),
  expires_in_minutes: z.number().int().min(5).max(1440).optional().default(30),
});

/**
 * POST /api/keykeeper/intake/generate
 * Creates a one-time intake token and returns a magic link URL.
 * Auth required.
 */
export async function POST(request: Request) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasScope(auth, "agents:write")) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = generateSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { secret_name, provider, expires_in_minutes } = result.data;
  const expiresAt = new Date(Date.now() + expires_in_minutes * 60 * 1000);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("keykeeper_intake_tokens")
    .insert({
      owner_id: auth.profileId,
      secret_name,
      provider,
      expires_at: expiresAt.toISOString(),
    })
    .select("token, expires_at")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to create intake token" },
      { status: 500 }
    );
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://www.signalpot.dev";

  return NextResponse.json({
    token: data.token,
    url: `${siteUrl}/api/keykeeper/intake/${data.token}`,
    expires_at: data.expires_at,
  });
}
