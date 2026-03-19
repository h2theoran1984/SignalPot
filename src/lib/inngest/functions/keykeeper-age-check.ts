import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSecret, storeSecret } from "@/lib/keykeeper/vault";
import { getProvider } from "@/lib/keykeeper/providers";
import { notify } from "@/lib/notifications";

/**
 * Daily cron: checks all secrets for rotation based on their rotation_days setting.
 * For supported providers, rotates automatically (verify-then-swap).
 * For unsupported providers, generates an OTU intake URL and notifies the owner.
 */
export const keykeeperAgeCheck = inngest.createFunction(
  { id: "keykeeper-age-check", name: "KeyKeeper — Age Check", retries: 0 },
  { cron: "0 6 * * *" }, // daily 6am UTC
  async ({ step }) => {
    const admin = createAdminClient();

    // Step 1: Find all secrets due for rotation
    const dueSecrets = await step.run("find-due-secrets", async () => {
      const { data, error } = await admin.rpc("get_due_secrets");

      // Fallback to raw query if RPC doesn't exist
      if (error) {
        const { data: secrets } = await admin
          .from("keykeeper_secrets")
          .select("owner_id, name, provider, rotation_days, last_rotated_at");

        if (!secrets) return [];

        const now = Date.now();
        return secrets.filter((s) => {
          const lastRotated = new Date(s.last_rotated_at).getTime();
          const dueAt = lastRotated + s.rotation_days * 24 * 60 * 60 * 1000;
          return now >= dueAt;
        });
      }

      return data ?? [];
    });

    if (dueSecrets.length === 0) {
      return { message: "No secrets due for rotation", rotated: 0, fallback: 0 };
    }

    // Step 2: Rotate each due secret
    const results = await step.run("rotate-due-secrets", async () => {
      let rotated = 0;
      let fallback = 0;
      let failed = 0;

      for (const secret of dueSecrets) {
        const provider = getProvider(secret.provider);

        if (!provider.supported) {
          // Generate OTU intake URL for manual rotation
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h for scheduled rotations

          const { data: token } = await admin
            .from("keykeeper_intake_tokens")
            .insert({
              owner_id: secret.owner_id,
              secret_name: secret.name,
              provider: secret.provider,
              expires_at: expiresAt.toISOString(),
            })
            .select("token")
            .single();

          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.signalpot.dev";
          const url = token ? `${siteUrl}/api/keykeeper/intake/${token.token}` : null;

          await notify(
            admin,
            secret.owner_id,
            "rotation_due",
            "Credential rotation due",
            `Your ${secret.provider} key '${secret.name}' is due for rotation. Please submit a new key using the secure link we've generated for you.`,
            { secret_name: secret.name, provider: secret.provider, intake_url: url }
          );

          fallback++;
          continue;
        }

        // Auto-rotate supported provider
        const adminCreds = await readSecret(admin, secret.owner_id, `_admin:${secret.provider}`);

        if (!adminCreds) {
          await notify(
            admin,
            secret.owner_id,
            "rotation_failed",
            "Credential rotation needs attention",
            `Your ${secret.provider} key '${secret.name}' is due for rotation, but we don't have admin credentials set up for auto-rotation. Please rotate it manually.`,
            { secret_name: secret.name, provider: secret.provider }
          );
          failed++;
          continue;
        }

        try {
          // Notify before rotation
          await notify(
            admin,
            secret.owner_id,
            "rotation_due",
            "Rotating your credential",
            `Your ${secret.provider} key '${secret.name}' is due for rotation — we're handling it now.`,
            { secret_name: secret.name, provider: secret.provider }
          );

          const result = await provider.rotate(adminCreds);
          const isValid = await provider.verify(result.newKey);

          if (!isValid) {
            await notify(
              admin,
              secret.owner_id,
              "rotation_failed",
              "Credential rotation failed",
              `We tried to rotate your ${secret.provider} key '${secret.name}', but the new key didn't pass verification. Your current key is still active.`,
              { secret_name: secret.name, provider: secret.provider }
            );
            failed++;
            continue;
          }

          await storeSecret(
            admin,
            secret.owner_id,
            secret.name,
            result.newKey,
            secret.provider as "openai" | "stripe" | "github" | "other"
          );

          await admin
            .from("keykeeper_secrets")
            .update({ last_rotated_at: new Date().toISOString() })
            .eq("owner_id", secret.owner_id)
            .eq("name", secret.name);

          await notify(
            admin,
            secret.owner_id,
            "rotation_complete",
            "Credential rotated successfully",
            `Your ${secret.provider} key '${secret.name}' has been rotated. The new key is active and verified.`,
            { secret_name: secret.name, provider: secret.provider }
          );

          rotated++;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error(`[keykeeper-age-check] Rotation failed for ${secret.name}: ${message}`);

          await notify(
            admin,
            secret.owner_id,
            "rotation_failed",
            "Credential rotation failed",
            `We encountered an issue rotating your ${secret.provider} key '${secret.name}'. Your current key is still active. Please check your admin credentials.`,
            { secret_name: secret.name, provider: secret.provider }
          );
          failed++;
        }
      }

      return { rotated, fallback, failed };
    });

    return {
      message: "Age check complete",
      due: dueSecrets.length,
      ...results,
    };
  }
);
