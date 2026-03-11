/**
 * Seed initial prompt versions for "The Next Step" text-analyzer agent.
 * Copies the 3 hardcoded system prompts into prompt_versions as version 1 (active).
 *
 * Usage: SP_BASE_URL=https://www.signalpot.dev npx tsx scripts/seed-prompts.ts
 *
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars
 * (or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://xrqcxdrqymotddtmogrv.supabase.co";

const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY env var");
  process.exit(1);
}

const AGENT_SLUG = "the-next-step";

// The 3 system prompts — copied verbatim from the text-analyzer source
const PROMPTS: Array<{
  capability: string;
  system_prompt: string;
  model: string;
  max_tokens: number;
  temperature: number;
}> = [
  {
    capability: "signalpot/meeting-summary@v1",
    system_prompt: `Expert meeting summarizer. Concise, accurate, structured. Never fabricate facts.

Output ONLY valid JSON (no markdown, no explanation):
{"summary":"2-3 sentences max","action_items":[{"task":"...","owner":"...","due":"...","notes":"...","next_step":"..."}],"decisions":["..."],"participants":["..."],"meeting_tone":"productive|tense|collaborative|unfocused|urgent"}

Rules: Infer due dates or use "TBD". Unassigned if no owner. Decisions = firm commitments only.
BREVITY IS CRITICAL: summary under 40 words. Each notes/next_step under 8 words. Each task under 12 words. Each decision under 15 words. Minimize total output tokens.`,
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    temperature: 0,
  },
  {
    capability: "signalpot/action-items@v1",
    system_prompt: `Extract action items from meeting transcripts. Output ONLY valid JSON (no markdown).
{"action_items":[{"task":"...","owner":"...","due":"...","notes":"...","next_step":"..."}],"count":0}
Rules: "TBD" if no due date. "Unassigned" if no owner. Keep fields SHORT — under 15 words each.`,
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    temperature: 0,
  },
  {
    capability: "signalpot/sentiment@v1",
    system_prompt: `You analyze the emotional tone of meeting transcripts and conversations.

Return a JSON object with:
- "sentiment": one of "positive", "negative", "neutral", "mixed"
- "score": number from -1 (very negative) to 1 (very positive)
- "confidence": number from 0 to 1
- "meeting_tone": a short phrase describing the meeting dynamic (e.g. "productive and focused", "tense negotiation", "casual brainstorm", "urgent firefighting")
- "emotions": object with scores 0-1 for: joy, anger, sadness, fear, surprise

Respond with ONLY valid JSON, no markdown, no code blocks.`,
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    temperature: 0,
  },
];

async function supabaseRest(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method ?? "GET",
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${options.method ?? "GET"} ${path} failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function main() {
  console.log("Looking up agent:", AGENT_SLUG);

  // Fetch agent ID by slug
  const agents = (await supabaseRest(
    `agents?slug=eq.${AGENT_SLUG}&select=id,name,slug`
  )) as Array<{ id: string; name: string; slug: string }>;

  if (!agents.length) {
    console.error(`Agent '${AGENT_SLUG}' not found. Has the seed script been run?`);
    process.exit(1);
  }

  const agent = agents[0];
  console.log(`Found: ${agent.name} (${agent.id})`);

  // Check for existing versions
  const existing = (await supabaseRest(
    `prompt_versions?agent_id=eq.${agent.id}&select=id,capability,version`
  )) as Array<{ id: string; capability: string; version: number }>;

  if (existing.length > 0) {
    console.log(`Already seeded (${existing.length} versions exist). Skipping.`);
    console.log("  Existing:", existing.map((e) => `${e.capability} v${e.version}`).join(", "));
    return;
  }

  // Insert version 1 for each capability (active)
  for (const prompt of PROMPTS) {
    console.log(`Seeding: ${prompt.capability} v1`);

    await supabaseRest("prompt_versions", {
      method: "POST",
      body: {
        agent_id: agent.id,
        capability: prompt.capability,
        version: 1,
        system_prompt: prompt.system_prompt,
        model: prompt.model,
        max_tokens: prompt.max_tokens,
        temperature: prompt.temperature,
        is_active: true,
      },
    });
  }

  console.log("\nDone! Seeded 3 prompt versions (all active).");
  console.log("Agent ID for SIGNALPOT_AGENT_ID env var:", agent.id);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
