// POST /api/verify/evaluate — Register an external agent and run the evaluation pipeline.
// Creates the agent record, generates pattern challenges, runs 5 matches against sparring partner,
// and returns the initial trust score + verified badge.

export const maxDuration = 300; // 5 minutes — evaluation runs multiple matches

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAllChallenges } from "@/lib/arena/challenge-generator";

export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const endpoint = body.endpoint as string;
  const name = body.name as string;
  const description = body.description as string | undefined;
  const capabilities = body.capabilities as Array<{ name: string; description?: string }> | undefined;

  if (!endpoint || !name) {
    return NextResponse.json({ error: "Missing endpoint or name" }, { status: 400 });
  }

  const admin = createAdminClient();
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://signalpot.dev";

  // ── 1. Create or find the agent ───────────────────────────────────
  // Generate a slug from the name
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  // Check if agent already exists with this slug
  const { data: existing } = await admin
    .from("agents")
    .select("id, slug")
    .eq("slug", slug)
    .maybeSingle();

  let agentId: string;
  let agentSlug: string;

  if (existing) {
    agentId = existing.id as string;
    agentSlug = existing.slug as string;
  } else {
    // Register the agent
    const { data: newAgent, error: createErr } = await admin
      .from("agents")
      .insert({
        name,
        slug,
        description: description ?? null,
        mcp_endpoint: endpoint,
        owner_id: auth.profileId,
        status: "active",
        arena_eligible: true,
        rate_type: "per_call",
        rate_amount: 0,
        auth_type: "none",
        capability_schema: capabilities ?? [],
        tags: ["verified", "external"],
        agent_type: "autonomous",
      })
      .select("id, slug")
      .single();

    if (createErr || !newAgent) {
      return NextResponse.json(
        { error: `Failed to register agent: ${createErr?.message}` },
        { status: 500 }
      );
    }

    agentId = newAgent.id as string;
    agentSlug = newAgent.slug as string;
  }

  // ── 2. Generate pattern challenges ────────────────────────────────
  try {
    await generateAllChallenges(admin, agentId, 1);
  } catch (err) {
    console.warn("[verify] Challenge generation failed:", err);
    // Non-fatal — we can still try to run matches
  }

  // ── 3. Run evaluation matches ─────────────────────────────────────
  // Call the fight endpoint for each pattern
  const patterns = ["single_task", "routing", "chain_of_thought", "adversarial", "efficiency"];
  let matchCount = 0;
  const fightUrl = `${baseUrl}/api/arena/fight`;

  // Forward auth headers
  const authHeader = request.headers.get("authorization");
  const cookieHeader = request.headers.get("cookie");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  if (cookieHeader) headers["Cookie"] = cookieHeader;

  // Use first capability or "general"
  const capability = capabilities?.[0]?.name ?? "general";

  for (const patternId of patterns) {
    try {
      const res = await fetch(fightUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          agent_a_slug: agentSlug,
          agent_b_slug: "sparring-partner",
          capability,
          pattern_id: patternId,
          level: 1,
        }),
      });

      if (res.ok) {
        matchCount++;
      } else {
        const errData = await res.json().catch(() => ({}));
        console.warn(`[verify] Fight for ${patternId} failed:`, errData);
      }
    } catch (err) {
      console.warn(`[verify] Fight for ${patternId} error:`, err);
    }
  }

  // ── 4. Fetch results ──────────────────────────────────────────────
  // Get the trust score (may be 0 if this is first time)
  const { data: trustEdge } = await admin
    .from("trust_edges")
    .select("trust_score")
    .eq("target_agent_id", agentId)
    .order("trust_score", { ascending: false })
    .limit(1)
    .maybeSingle();

  const trustScore = (trustEdge?.trust_score as number) ?? 0;

  // Mark agent as verified
  await admin
    .from("agents")
    .update({ verified: true })
    .eq("id", agentId);

  // ── 5. Build response ─────────────────────────────────────────────
  const beaconSnippet = `fetch("${baseUrl}/api/track", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    agent: "${agentSlug}",
    event: "call_completed",
    capability: "...",
    duration_ms: elapsed,
    api_cost: 0.003,
    success: true
  })
});`;

  return NextResponse.json({
    agentSlug,
    agentName: name,
    matchCount,
    trustScore: Math.round(trustScore * 10000) / 10000,
    verifiedBadgeUrl: `${baseUrl}/api/agents/${agentSlug}/badge`,
    extractUrl: `/arena/training/${agentSlug}/extract`,
    beaconSnippet,
  });
}
