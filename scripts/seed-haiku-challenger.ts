/**
 * Seed the Haiku Challenger — a domain-expert market analytics agent
 * that uses Haiku (cheapest model) with deep domain knowledge to beat
 * expensive generic agents.
 *
 * Usage:
 *   PLATFORM_OWNER_ID=<uuid> npx tsx scripts/seed-haiku-challenger.ts
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
  console.error("Missing PLATFORM_OWNER_ID");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1. Upsert the Haiku Challenger agent
  const { data: agent, error } = await admin
    .from("agents")
    .upsert(
      {
        owner_id: ownerId,
        name: "The Underdog",
        slug: "the-underdog",
        description:
          "A Haiku-powered market analytics agent that punches above its weight. Built with deep CPG/retail domain knowledge — knows vendor data patterns, market share mechanics, and competitive dynamics that generic models miss. Proof that expertise beats compute.",
        listing_type: "standard",
        mcp_endpoint: `${siteUrl}/api/arena/sparring`,
        capability_schema: [
          {
            name: "analyze",
            description:
              "Market-aware sentiment and trend analysis. Understands CPG terminology, vendor data patterns, market share dynamics, and competitive positioning.",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string", description: "Text to analyze" },
                context: { type: "string", description: "Optional analysis context" },
              },
              required: ["text"],
            },
            outputSchema: {
              type: "object",
              properties: {
                sentiment: { type: "string", enum: ["positive", "negative", "neutral", "mixed"] },
                scores: {
                  type: "object",
                  properties: {
                    positive: { type: "number" },
                    negative: { type: "number" },
                    neutral: { type: "number" },
                  },
                },
                sentences: { type: "array", items: { type: "object" } },
              },
            },
          },
        ],
        rate_type: "per_call",
        rate_amount: 0.001,
        rate_currency: "USD",
        auth_type: "none",
        tags: ["analytics", "market-research", "cpg", "haiku", "domain-expert", "underdog"],
        status: "active",
        visibility: "public",
        goal: "Prove that a cheap model with deep domain knowledge beats an expensive model with generic prompts at market analytics tasks.",
        decision_logic:
          "Uses Haiku with market-analytics-specific system prompts that encode CPG industry knowledge, vendor data patterns, and competitive analysis frameworks. The domain knowledge compensates for the smaller model.",
        agent_type: "reactive",
      },
      { onConflict: "slug" }
    )
    .select("id, slug")
    .single();

  if (error) {
    console.error("Failed to upsert The Underdog:", error.message);
    process.exit(1);
  }

  console.log(`The Underdog: ${agent.id} (${agent.slug})`);

  // 2. Create a market analytics challenge
  const { data: challenge, error: challengeErr } = await admin
    .from("arena_challenges")
    .upsert(
      {
        title: "Market Share Shift Analysis",
        description:
          "Analyze a quarterly market share report and identify the key competitive dynamics. The data shows unit share shifts across brands in the OTC pain relief category. Identify winners, losers, the likely drivers of share movement, and what to watch next quarter.",
        capability: "analyze",
        difficulty: "hard",
        featured: true,
        template_prompt: JSON.stringify({
          text: "Q4 2025 OTC Pain Relief Market Share Report (Nielsen xAOC+C):\n\nTylenol: 23.1% unit share (-1.8pp YoY), $892M revenue (-3.2%)\nAdvil: 18.7% unit share (+0.4pp YoY), $743M revenue (+2.1%)\nAleve: 12.3% unit share (+1.2pp YoY), $498M revenue (+8.7%)\nMotrin: 8.1% unit share (-0.3pp YoY), $312M revenue (-1.8%)\nExcedrin: 5.9% unit share (-0.2pp YoY), $228M revenue (-2.1%)\nPrivate Label: 19.4% unit share (+1.1pp YoY), $412M revenue (+12.3%)\nAll Other: 12.5% unit share (-0.4pp YoY), $387M revenue (-1.5%)\n\nCategory total: $3.47B (-0.3% vs YA)\nTotal units: 1.2B (+0.8% vs YA)\n\nKey notes:\n- Aleve launched new arthritis-specific SKU in September\n- Walmart expanded private label shelf space in Q3\n- Tylenol had a voluntary recall of one lot in October\n- Category shifted toward NSAIDs vs acetaminophen\n- Dollar/unit gap suggests mix shift toward premium/specialty",
          context: "Provide a comprehensive competitive analysis suitable for a brand team strategy meeting. Include sentiment, key takeaways, and recommended actions."
        }),
        task_variables: JSON.stringify({}),
        active: true,
      },
      { onConflict: "title" }
    )
    .select("id, title")
    .single();

  if (challengeErr) {
    console.error("Failed to upsert challenge:", challengeErr.message);
  } else {
    console.log(`Challenge: ${challenge.id} (${challenge.title})`);
  }

  // 3. Make the agent arena-eligible
  const { error: eligibleErr } = await admin
    .from("agents")
    .update({ arena_eligible: true })
    .eq("id", agent.id);

  if (eligibleErr) {
    console.log("Note: arena_eligible update failed (column may not exist yet):", eligibleErr.message);
  }

  console.log("\nReady to fight. Create a match:");
  console.log(`  Agent A (Underdog): ${agent.id}`);
  console.log(`  Agent B (Sparring Partner): look up by slug 'sparring-partner'`);
  console.log(`  Capability: analyze`);
  console.log(`  Challenge: ${challenge?.id ?? 'use the one above'}`);
}

main();
