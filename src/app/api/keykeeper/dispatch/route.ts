import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSecret, storeSecret } from "@/lib/keykeeper/vault";
import { getProvider } from "@/lib/keykeeper/providers";
import { timingSafeEqual } from "crypto";
import { z } from "zod";

const INTERNAL_KEY = process.env.INTERNAL_DISPATCH_KEY;

const intakeInputSchema = z.object({
  secret_name: z.string().min(1).max(100).trim(),
  provider: z.enum(["openai", "stripe", "github", "other"]),
  expires_in_minutes: z.number().int().min(5).max(1440).optional().default(30),
});

const resolveInputSchema = z.object({
  secret_name: z.string().min(1).max(100).trim(),
  owner_id: z.string().uuid(),
});

const rotateInputSchema = z.object({
  secret_name: z.string().min(1).max(100).trim(),
  owner_id: z.string().uuid(),
});

/**
 * POST /api/keykeeper/dispatch
 * Internal suite dispatch endpoint — receives forwarded requests from the proxy
 * when a caller invokes keykeeper-courier through the suite routing.
 */
export async function POST(request: Request) {
  // 1. Verify internal origin — fail-closed: reject if key is not configured
  if (!INTERNAL_KEY) {
    return NextResponse.json(
      { error: "Internal dispatch not configured" },
      { status: 503 }
    );
  }

  const provided = request.headers.get("x-signalpot-internal") ?? "";
  const keyBuf = Buffer.from(INTERNAL_KEY);
  const providedBuf = Buffer.from(provided);
  if (keyBuf.length !== providedBuf.length || !timingSafeEqual(keyBuf, providedBuf)) {
    return NextResponse.json(
      { error: "Forbidden — internal endpoint" },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const capability = body.capability as string | undefined;
  const input = body.input as Record<string, unknown> | undefined;
  const jobId = body.job_id as string | undefined;

  if (!capability || !input) {
    return NextResponse.json(
      { error: "Missing capability or input" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // 2. Dispatch by capability
  switch (capability) {
    case "credential.intake": {
      const parsed = intakeInputSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      const { secret_name, provider, expires_in_minutes } = parsed.data;
      const expiresAt = new Date(
        Date.now() + expires_in_minutes * 60 * 1000
      );

      // Need an owner_id — for intake, use the requester from the job record
      let ownerId: string | null = null;
      if (jobId) {
        const { data: job } = await admin
          .from("jobs")
          .select("requester_profile_id")
          .eq("id", jobId)
          .single();
        ownerId = job?.requester_profile_id ?? null;
      }

      if (!ownerId) {
        return NextResponse.json(
          { error: "credential.intake requires an authenticated caller" },
          { status: 401 }
        );
      }

      const { data: token, error: tokenErr } = await admin
        .from("keykeeper_intake_tokens")
        .insert({
          owner_id: ownerId,
          secret_name,
          provider,
          expires_at: expiresAt.toISOString(),
        })
        .select("token, expires_at")
        .single();

      if (tokenErr) {
        return NextResponse.json(
          { error: "Failed to create intake token" },
          { status: 500 }
        );
      }

      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.signalpot.dev";

      return NextResponse.json({
        url: `${siteUrl}/api/keykeeper/intake/${token.token}`,
        expires_at: token.expires_at,
      });
    }

    case "credential.resolve": {
      const parsed = resolveInputSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      const { secret_name, owner_id } = parsed.data;

      const value = await readSecret(admin, owner_id, secret_name);
      if (value === null) {
        return NextResponse.json(
          { error: "Secret not found" },
          { status: 404 }
        );
      }

      // Return with sensitive flag — proxy will redact from job history
      return NextResponse.json({
        value,
        sensitive: true,
      });
    }

    case "credential.rotate": {
      const parsed = rotateInputSchema.safeParse(input);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        );
      }

      const { secret_name, owner_id } = parsed.data;

      // Look up secret metadata to get provider
      const { data: secretRow } = await admin
        .from("keykeeper_secrets")
        .select("provider")
        .eq("owner_id", owner_id)
        .eq("name", secret_name)
        .single();

      if (!secretRow) {
        return NextResponse.json(
          { error: "Secret not found" },
          { status: 404 }
        );
      }

      const provider = getProvider(secretRow.provider);

      // Unsupported provider — fall back to OTU intake
      if (!provider.supported) {
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

        const { data: token, error: tokenErr } = await admin
          .from("keykeeper_intake_tokens")
          .insert({
            owner_id,
            secret_name,
            provider: secretRow.provider,
            expires_at: expiresAt.toISOString(),
          })
          .select("token, expires_at")
          .single();

        if (tokenErr) {
          return NextResponse.json(
            { error: "Failed to create intake token" },
            { status: 500 }
          );
        }

        const siteUrl =
          process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.signalpot.dev";

        return NextResponse.json({
          rotated: false,
          fallback: "intake",
          url: `${siteUrl}/api/keykeeper/intake/${token.token}`,
          expires_at: token.expires_at,
          message: "Provider does not support auto-rotation. Use the intake URL to submit a new key.",
        });
      }

      // Supported provider — rotate programmatically
      const adminCreds = await readSecret(
        admin,
        owner_id,
        `_admin:${secretRow.provider}`
      );

      if (!adminCreds) {
        return NextResponse.json(
          {
            error: `Admin credentials not configured for ${secretRow.provider}`,
            hint: `Store admin creds via credential.intake with secret_name '_admin:${secretRow.provider}'`,
          },
          { status: 400 }
        );
      }

      // Generate new key
      let newKey: string;
      try {
        const result = await provider.rotate(adminCreds);
        newKey = result.newKey;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Rotation failed";
        return NextResponse.json(
          { error: `Key rotation failed: ${message}` },
          { status: 502 }
        );
      }

      // Verify new key works before storing
      const isValid = await provider.verify(newKey);
      if (!isValid) {
        return NextResponse.json(
          { error: "New key verification failed — old key preserved" },
          { status: 400 }
        );
      }

      // Store new key (overwrites old) and update rotation timestamp
      await storeSecret(
        admin,
        owner_id,
        secret_name,
        newKey,
        secretRow.provider as "openai" | "stripe" | "github" | "other"
      );

      await admin
        .from("keykeeper_secrets")
        .update({ last_rotated_at: new Date().toISOString() })
        .eq("owner_id", owner_id)
        .eq("name", secret_name);

      return NextResponse.json({
        rotated: true,
        provider: secretRow.provider,
        secret_name,
      });
    }

    default:
      return NextResponse.json(
        { error: `Unknown capability: ${capability}` },
        { status: 400 }
      );
  }
}
