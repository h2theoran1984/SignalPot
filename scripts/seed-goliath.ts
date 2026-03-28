/**
 * Seed The Goliath — an Opus-powered generic agent.
 * The expensive benchmark. No domain knowledge, just raw model power.
 *
 * Usage:
 *   PLATFORM_OWNER_ID=<uuid> npx tsx scripts/seed-goliath.ts
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerId = process.env.PLATFORM_OWNER_ID;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.signalpot.dev";

if (!supabaseUrl || !serviceRoleKey || !ownerId) {
  console.error("Missing env vars");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1. Upsert The Goliath agent
  const { data: agent, error } = await admin
    .from("agents")
    .upsert(
      {
        owner_id: ownerId,
        name: "The Goliath",
        slug: "the-goliath",
        description:
          "Opus-powered general-purpose analyst. No domain specialization — just raw model intelligence and brute-force reasoning. The expensive benchmark that domain experts try to dethrone.",
        listing_type: "standard",
        mcp_endpoint: `${siteUrl}/api/arena/goliath`,
        capability_schema: [
          {
            name: "analyze",
            description: "General-purpose data analysis using Opus",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string" },
                context: { type: "string" },
              },
              required: ["text"],
            },
            outputSchema: {
              type: "object",
              properties: {
                sentiment: { type: "string" },
                scores: { type: "object" },
                sentences: { type: "array" },
              },
            },
          },
        ],
        rate_type: "per_call",
        rate_amount: 0.05, // Opus pricing — ~$0.05 per call
        rate_currency: "USD",
        auth_type: "none",
        tags: ["opus", "general-purpose", "benchmark", "expensive", "goliath"],
        status: "active",
        visibility: "public",
        arena_eligible: true,
        goal: "Serve as the expensive benchmark — pure Opus intelligence with no domain optimization. The target for domain experts to beat with cheaper, smarter agents.",
        decision_logic: "Uses Opus with a generic analysis prompt. No domain-specific knowledge. Relies entirely on model capability.",
        agent_type: "reactive",
      },
      { onConflict: "slug" }
    )
    .select("id, slug")
    .single();

  if (error) {
    console.error("Failed to upsert The Goliath:", error.message);
    process.exit(1);
  }

  console.log(`The Goliath: ${agent.id} (${agent.slug})`);

  // 2. Set ELO to 1500
  const { error: ratingError } = await admin
    .from("arena_ratings")
    .upsert(
      {
        agent_id: agent.id,
        capability: "analyze",
        elo: 1500,
        matches_played: 0,
        wins: 0,
        losses: 0,
        ties: 0,
      },
      { onConflict: "agent_id,capability" }
    );

  if (ratingError) {
    console.log("Note: ELO setup issue:", ratingError.message);
  } else {
    console.log("ELO set to 1500 for analyze capability");
  }

  console.log("\nThe Goliath is ready. Challenge it in the Arena:");
  console.log(`  Agent: ${agent.slug}`);
  console.log(`  Rate: $0.05/call (Opus pricing)`);
  console.log(`  ELO: 1500`);
}

main();
