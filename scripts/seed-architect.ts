/**
 * Seed The Architect — the meta-agent that creates other agents.
 *
 * Usage:
 *   PLATFORM_OWNER_ID=<uuid> npx tsx scripts/seed-architect.ts
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerId = process.env.PLATFORM_OWNER_ID;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.signalpot.dev";

if (!supabaseUrl || !serviceRoleKey || !ownerId) {
  console.error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PLATFORM_OWNER_ID");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: agent, error } = await admin
    .from("agents")
    .upsert(
      {
        owner_id: ownerId,
        name: "The Architect",
        slug: "the-architect",
        description:
          "Meta-agent that creates and refines other agents from natural language descriptions. Describe what you need, and The Architect builds a fully functional, Arena-ready agent — no code required.",
        listing_type: "standard",
        mcp_endpoint: `${siteUrl}/api/arena/architect`,
        capability_schema: [
          {
            name: "create_agent",
            description:
              "Create a new agent from a plain-English description. Returns a registered, Arena-ready agent with a smoke test result.",
            inputSchema: {
              type: "object",
              properties: {
                description: {
                  type: "string",
                  description:
                    "Plain English description of what the agent should do. Be specific about the domain, what data it works with, and what insights it should produce.",
                },
                model_preference: {
                  type: "string",
                  enum: ["haiku", "sonnet", "opus"],
                  description:
                    "Model to power the agent. Haiku is cheap and fast (recommended for most agents). Sonnet for complex reasoning. Opus for maximum capability.",
                },
                rate: {
                  type: "number",
                  description: "Cost per API call in USD. Defaults to model-appropriate rate.",
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description: "Tags for discovery and categorization.",
                },
              },
              required: ["description"],
            },
            outputSchema: {
              type: "object",
              properties: {
                agent: {
                  type: "object",
                  properties: {
                    slug: { type: "string" },
                    name: { type: "string" },
                    status: { type: "string" },
                    capabilities: { type: "array", items: { type: "string" } },
                    model: { type: "string" },
                    rate: { type: "number" },
                    arena_url: { type: "string" },
                  },
                },
                smoke_test: {
                  type: "object",
                  properties: {
                    passed: { type: "boolean" },
                    error: { type: "string" },
                    duration_ms: { type: "number" },
                  },
                },
              },
            },
          },
        ],
        rate_type: "per_call",
        rate_amount: 0.01,
        rate_currency: "USD",
        status: "active",
        arena_eligible: false, // The Architect doesn't compete — it creates
        agent_type: "reactive",
        tags: ["meta", "agent-factory", "platform"],
        goal: "Create and refine domain-expert agents from natural language descriptions",
        decision_logic:
          "Parse user intent → generate capability schema → engineer domain-tuned system prompt → register agent → run smoke test to verify it works",
      },
      { onConflict: "slug" }
    )
    .select("id, slug, name")
    .single();

  if (error) {
    console.error("Failed to seed The Architect:", error.message);
    process.exit(1);
  }

  console.log("Seeded The Architect:");
  console.log(`  ID:   ${agent.id}`);
  console.log(`  Slug: ${agent.slug}`);
  console.log(`  Name: ${agent.name}`);
  console.log(`  Endpoint: ${siteUrl}/api/arena/architect`);
}

main();
