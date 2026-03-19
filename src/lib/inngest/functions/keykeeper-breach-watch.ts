import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSecret, storeSecret } from "@/lib/keykeeper/vault";
import { getProvider } from "@/lib/keykeeper/providers";
import { notify } from "@/lib/notifications";

const HIBP_API_KEY = process.env.HIBP_API_KEY;

/** Map provider names to domains for HIBP lookup */
const PROVIDER_DOMAINS: Record<string, string> = {
  stripe: "stripe.com",
  github: "github.com",
  openai: "openai.com",
};

interface HibpBreach {
  Name: string;
  Domain: string;
  BreachDate: string;
  ModifiedDate: string;
  Description: string;
}

/**
 * Daily cron: checks HaveIBeenPwned for recent breaches affecting
 * providers with stored secrets. Triggers emergency rotation when detected.
 */
export const keykeeperBreachWatch = inngest.createFunction(
  { id: "keykeeper-breach-watch", name: "KeyKeeper — Breach Watch", retries: 0 },
  { cron: "0 7 * * *" }, // daily 7am UTC
  async ({ step }) => {
    const admin = createAdminClient();

    // Step 1: Fetch recent breaches from HIBP
    const breachedProviders = await step.run("fetch-breach-signals", async () => {
      if (!HIBP_API_KEY) {
        console.log("[breach-watch] HIBP_API_KEY not configured, skipping breach check");
        return [];
      }

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const affected: string[] = [];

      for (const [provider, domain] of Object.entries(PROVIDER_DOMAINS)) {
        try {
          const res = await fetch(
            `https://haveibeenpwned.com/api/v3/breaches?domain=${domain}`,
            {
              headers: {
                "hibp-api-key": HIBP_API_KEY,
                "User-Agent": "SignalPot-KeyKeeper",
              },
            }
          );

          if (!res.ok) continue;

          const breaches = (await res.json()) as HibpBreach[];

          const recent = breaches.some((b) => {
            const modified = new Date(b.ModifiedDate);
            return modified >= yesterday;
          });

          if (recent) {
            affected.push(provider);
          }

          // Rate limit: HIBP requires 6 second delay between requests
          await new Promise((resolve) => setTimeout(resolve, 6100));
        } catch (err) {
          console.error(`[breach-watch] HIBP check failed for ${domain}:`, err);
        }
      }

      return affected;
    });

    if (breachedProviders.length === 0) {
      return { message: "No breaches detected", affected_providers: 0, rotated: 0 };
    }

    // Step 2: Find all secrets for affected providers
    const affectedSecrets = await step.run("match-affected-secrets", async () => {
      const { data: secrets } = await admin
        .from("keykeeper_secrets")
        .select("owner_id, name, provider")
        .in("provider", breachedProviders);

      return secrets ?? [];
    });

    if (affectedSecrets.length === 0) {
      return {
        message: "Breaches detected but no matching secrets stored",
        affected_providers: breachedProviders,
        rotated: 0,
      };
    }

    // Step 3: Emergency rotate all affected secrets
    const results = await step.run("emergency-rotate", async () => {
      let rotated = 0;
      let fallback = 0;
      let failed = 0;

      for (const secret of affectedSecrets) {
        const provider = getProvider(secret.provider);

        if (!provider.supported) {
          // Unsupported provider — generate OTU and notify urgently
          const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4h for breach urgency

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
            "breach_alert",
            "Security alert — rotate your key now",
            `We detected a security alert affecting ${secret.provider}. Please rotate your key '${secret.name}' immediately using the secure link provided.`,
            { secret_name: secret.name, provider: secret.provider, intake_url: url, breach: true }
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
            "breach_alert",
            "Security alert — action required",
            `We detected a security alert affecting ${secret.provider}. Your key '${secret.name}' should be rotated immediately, but auto-rotation isn't set up. Please rotate it manually as soon as possible.`,
            { secret_name: secret.name, provider: secret.provider, breach: true }
          );
          failed++;
          continue;
        }

        try {
          const result = await provider.rotate(adminCreds);
          const isValid = await provider.verify(result.newKey);

          if (!isValid) {
            await notify(
              admin,
              secret.owner_id,
              "breach_alert",
              "Security alert — rotation failed",
              `We detected a security alert affecting ${secret.provider} and tried to rotate your key '${secret.name}', but the new key didn't pass verification. Please rotate it manually immediately.`,
              { secret_name: secret.name, provider: secret.provider, breach: true }
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
            "Emergency rotation complete",
            `We detected a security alert affecting ${secret.provider}. Your key '${secret.name}' has been automatically rotated as a precaution. The new key is active and verified.`,
            { secret_name: secret.name, provider: secret.provider, breach: true }
          );

          rotated++;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error(`[breach-watch] Emergency rotation failed for ${secret.name}: ${message}`);

          await notify(
            admin,
            secret.owner_id,
            "breach_alert",
            "Security alert — rotation failed",
            `We detected a security alert affecting ${secret.provider} and tried to rotate your key '${secret.name}', but encountered an error. Please rotate it manually immediately.`,
            { secret_name: secret.name, provider: secret.provider, breach: true }
          );
          failed++;
        }
      }

      return { rotated, fallback, failed };
    });

    return {
      message: "Breach watch complete",
      affected_providers: breachedProviders,
      affected_secrets: affectedSecrets.length,
      ...results,
    };
  }
);
