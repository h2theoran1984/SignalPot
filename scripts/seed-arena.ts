/**
 * SignalPot Arena Seed Script
 * Seeds challenge prompts and demo completed matches.
 *
 * Usage:
 *   SP_API_KEY=sp_live_... npx tsx scripts/seed-arena.ts
 *
 * Optional:
 *   SP_BASE_URL=http://localhost:3002  (defaults to https://www.signalpot.dev)
 */

const BASE_URL = process.env.SP_BASE_URL ?? "https://www.signalpot.dev";
const API_KEY = process.env.SP_API_KEY;

if (!API_KEY) {
  console.error("❌  SP_API_KEY environment variable is required.");
  process.exit(1);
}

const HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${API_KEY}`,
};

// ---------------------------------------------------------------------------
// Challenge definitions
// ---------------------------------------------------------------------------
const CHALLENGES = [
  {
    title: "Explain Quantum Computing",
    description: "Summarize quantum computing in 3 sentences for a non-technical audience.",
    capability: "search",
    prompt: { query: "explain quantum computing in simple terms" },
    difficulty: "medium",
    tags: ["science", "explanation"],
    featured: true,
  },
  {
    title: "Find Latest AI News",
    description: "Search for the most recent AI breakthroughs and discoveries.",
    capability: "search",
    prompt: { query: "latest artificial intelligence breakthroughs 2026", max_results: 5 },
    difficulty: "easy",
    tags: ["ai", "news"],
    featured: false,
  },
  {
    title: "Summarize Climate Change Solutions",
    description: "Find and summarize top proposed solutions to climate change.",
    capability: "search",
    prompt: { query: "most promising climate change solutions 2026", max_results: 10 },
    difficulty: "medium",
    tags: ["climate", "summary"],
    featured: false,
  },
  {
    title: "Compare Programming Languages",
    description: "Search for a comparison of Rust vs Go for backend development.",
    capability: "search",
    prompt: { query: "rust vs go backend development comparison", max_results: 5 },
    difficulty: "easy",
    tags: ["programming", "comparison"],
    featured: false,
  },
  {
    title: "Find Startup Funding Trends",
    description: "Research current startup funding trends and top VC investments.",
    capability: "search",
    prompt: { query: "startup funding trends Q1 2026", max_results: 10 },
    difficulty: "hard",
    tags: ["business", "finance"],
    featured: false,
  },
  {
    title: "Explain Blockchain Consensus",
    description: "Find clear explanations of proof-of-stake vs proof-of-work.",
    capability: "search",
    prompt: { query: "proof of stake vs proof of work explained", max_results: 5 },
    difficulty: "medium",
    tags: ["blockchain", "explanation"],
    featured: false,
  },
  {
    title: "Space Exploration Updates",
    description: "Search for the latest Mars mission updates and space exploration news.",
    capability: "search",
    prompt: { query: "mars mission updates 2026 space exploration", max_results: 5 },
    difficulty: "easy",
    tags: ["space", "science"],
    featured: false,
  },
  {
    title: "Cybersecurity Threat Landscape",
    description: "Research the current top cybersecurity threats and defenses.",
    capability: "search",
    prompt: { query: "top cybersecurity threats 2026 defense strategies", max_results: 10 },
    difficulty: "hard",
    tags: ["security", "research"],
    featured: false,
  },
  {
    title: "Best Practices for API Design",
    description: "Find current best practices for designing RESTful APIs.",
    capability: "search",
    prompt: { query: "REST API design best practices 2026", max_results: 5 },
    difficulty: "easy",
    tags: ["api", "development"],
    featured: false,
  },
  {
    title: "Economics of AI Agents",
    description: "Research how AI agent marketplaces and economies are evolving.",
    capability: "search",
    prompt: { query: "AI agent marketplace economics autonomous agents", max_results: 10 },
    difficulty: "hard",
    tags: ["ai", "economics", "agents"],
    featured: true,
  },
];

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------
async function seedChallenges() {
  console.log("\n⚔️  Seeding Arena Challenges...\n");

  // We need to use the Supabase admin client directly since there's no
  // challenge creation API endpoint yet. Use the matches listing to check
  // if challenges already exist.
  const checkRes = await fetch(`${BASE_URL}/api/arena/challenges?limit=1`, {
    headers: HEADERS,
  });

  if (checkRes.ok) {
    const data = await checkRes.json();
    if (data.total > 0) {
      console.log(`  ⏭️  Challenges already seeded (${data.total} found). Skipping.`);
      return;
    }
  }

  // Since there's no POST endpoint for challenges, we'll log them for manual insertion
  console.log("  📋 Challenge data prepared. These need to be inserted via Supabase SQL:\n");
  console.log("  INSERT INTO arena_challenges (title, description, capability, prompt, difficulty, tags, featured) VALUES");

  CHALLENGES.forEach((c, i) => {
    const comma = i < CHALLENGES.length - 1 ? "," : ";";
    console.log(`    ('${c.title.replace(/'/g, "''")}', '${c.description.replace(/'/g, "''")}', '${c.capability}', '${JSON.stringify(c.prompt).replace(/'/g, "''")}', '${c.difficulty}', ARRAY[${c.tags.map(t => `'${t}'`).join(",")}], ${c.featured})${comma}`);
  });

  console.log("\n  ✅ Copy and run the above SQL in Supabase SQL Editor.");
}

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  SignalPot Arena Seed");
  console.log("  Target: " + BASE_URL);
  console.log("═══════════════════════════════════════");

  await seedChallenges();

  // Check if arena matches API is reachable
  const matchesRes = await fetch(`${BASE_URL}/api/arena/matches?limit=1`, {
    headers: HEADERS,
  });

  if (matchesRes.ok) {
    const data = await matchesRes.json();
    console.log(`\n  📊 Arena Status: ${data.total} matches exist.`);
  } else {
    console.log(`\n  ⚠️  Arena matches API returned ${matchesRes.status}.`);
  }

  console.log("\n✅ Arena seed complete.\n");
}

main().catch(console.error);
