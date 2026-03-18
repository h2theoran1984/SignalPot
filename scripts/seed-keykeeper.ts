/**
 * Seed KeyKeeper suite agent and Courier sub-agent.
 *
 * Usage:
 *   npx tsx scripts/seed-keykeeper.ts
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   PLATFORM_OWNER_ID          — profile UUID that owns platform agents
 *   NEXT_PUBLIC_SITE_URL        — e.g. https://www.signalpot.dev
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerId = process.env.PLATFORM_OWNER_ID;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.signalpot.dev";

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!ownerId) {
  console.error("Missing PLATFORM_OWNER_ID — set to your profile UUID");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1. Upsert KeyKeeper suite agent
  const { data: suite, error: suiteErr } = await admin
    .from("agents")
    .upsert(
      {
        owner_id: ownerId,
        name: "KeyKeeper",
        slug: "keykeeper",
        description:
          "Encrypted secrets vault for agents. Manages API keys, tokens, and credentials with AES-256 encryption, one-time intake URLs, and automatic rotation reminders.",
        listing_type: "suite",
        mcp_endpoint: `${siteUrl}/api/keykeeper/dispatch`,
        capability_schema: [],
        rate_type: "per_call",
        rate_amount: 0,
        rate_currency: "USD",
        auth_type: "none",
        tags: ["secrets", "vault", "credentials", "platform"],
        status: "active",
        visibility: "public",
        goal: "Securely store, rotate, and deliver credentials to agents that need them — without ever exposing plaintext in logs, job history, or API responses.",
        decision_logic:
          "Routes requests to Courier sub-agent. Intake requests generate one-time URLs. Resolve requests decrypt in-memory only and return with sensitive flag to prevent persistence.",
        agent_type: "reactive",
      },
      { onConflict: "slug" }
    )
    .select("id, slug")
    .single();

  if (suiteErr) {
    console.error("Failed to upsert KeyKeeper suite:", suiteErr.message);
    process.exit(1);
  }

  console.log(`KeyKeeper suite: ${suite.id} (${suite.slug})`);

  // 2. Upsert Courier sub-agent
  const { data: courier, error: courierErr } = await admin
    .from("agents")
    .upsert(
      {
        owner_id: ownerId,
        name: "KeyKeeper Courier",
        slug: "keykeeper-courier",
        description:
          "Handles credential intake and resolution for the KeyKeeper suite. Generates one-time magic links for secure key submission and decrypts stored secrets in-memory for authorized callers.",
        listing_type: "standard",
        parent_agent_id: suite.id,
        mcp_endpoint: null,
        capability_schema: [
          {
            name: "credential.intake",
            description:
              "Generate a one-time intake URL for submitting an API key or credential securely.",
            inputSchema: {
              type: "object",
              properties: {
                secret_name: {
                  type: "string",
                  description: "Name to store the secret under",
                },
                provider: {
                  type: "string",
                  enum: ["openai", "stripe", "github", "other"],
                  description: "Provider type for categorization",
                },
                expires_in_minutes: {
                  type: "number",
                  description: "Minutes until the intake link expires (5-1440, default 30)",
                },
              },
              required: ["secret_name", "provider"],
            },
            outputSchema: {
              type: "object",
              properties: {
                url: { type: "string" },
                expires_at: { type: "string" },
              },
            },
          },
          {
            name: "credential.resolve",
            description:
              "Decrypt and return a stored secret in-memory. The result is never persisted to job history.",
            inputSchema: {
              type: "object",
              properties: {
                secret_name: {
                  type: "string",
                  description: "Name of the secret to resolve",
                },
                owner_id: {
                  type: "string",
                  description: "UUID of the secret owner",
                },
              },
              required: ["secret_name", "owner_id"],
            },
            outputSchema: {
              type: "object",
              properties: {
                value: { type: "string" },
                sensitive: { type: "boolean" },
              },
            },
          },
        ],
        rate_type: "per_call",
        rate_amount: 0,
        rate_currency: "USD",
        auth_type: "none",
        tags: ["secrets", "intake", "courier"],
        status: "active",
        visibility: "public",
        goal: "Execute credential operations on behalf of KeyKeeper suite — intake via OTU links, resolution via in-memory decryption.",
        decision_logic:
          "credential.intake: generates a time-limited one-time URL. credential.resolve: decrypts the named secret and returns it with sensitive=true so the proxy redacts it from job history.",
        agent_type: "reactive",
      },
      { onConflict: "slug" }
    )
    .select("id, slug, parent_agent_id")
    .single();

  if (courierErr) {
    console.error("Failed to upsert Courier:", courierErr.message);
    process.exit(1);
  }

  console.log(
    `Courier sub-agent: ${courier.id} (${courier.slug}) -> parent ${courier.parent_agent_id}`
  );
  console.log("Done.");
}

main();
