import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkArenaRateLimit } from "@/lib/rate-limit";
import { createMatchSchema } from "@/lib/arena/validations";
import { generateSyntheticPrompt } from "@/lib/arena/synthetic";
import { inngest } from "@/lib/inngest/client";
import { getArenaLimitForPlan, type Plan } from "@/lib/plans";
import { logAuditEvent, getClientIp } from "@/lib/audit";

/**
 * POST /api/arena/matches — Create a new arena match (auth required)
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Look up user's plan for tiered rate limiting
  const { data: profile } = await admin
    .from("profiles")
    .select("plan_type")
    .eq("id", auth.profileId)
    .single();
  const plan = (profile?.plan_type as Plan) ?? "free";
  const arenaLimit = getArenaLimitForPlan(plan);

  // Rate limit: tiered by plan (free: 5/hr, pro: 25/hr, team: 100/hr)
  const rateCheck = await checkArenaRateLimit(auth.profileId, arenaLimit);
  if (!rateCheck.success) {
    return NextResponse.json(
      {
        error: `Arena rate limit reached (${arenaLimit} matches/hour)`,
        limit: arenaLimit,
        plan,
        remaining: 0,
        retry_after: Math.ceil((rateCheck.reset - Date.now()) / 1000),
        hint: plan === "free" ? "Upgrade to Pro for 25 matches/hour" : undefined,
      },
      { status: 429 }
    );
  }

  // Parse body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createMatchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { agent_a_slug, agent_b_slug, capability, prompt: rawPrompt, prompt_text: rawPromptText, challenge_id } = parsed.data;

  // Look up both agents
  const { data: agentA } = await admin
    .from("agents")
    .select("id, slug, name, status, capability_schema, rate_amount")
    .eq("slug", agent_a_slug)
    .eq("status", "active")
    .single();

  if (!agentA) {
    return NextResponse.json({ error: `Agent '${agent_a_slug}' not found or inactive` }, { status: 404 });
  }

  const { data: agentB } = await admin
    .from("agents")
    .select("id, slug, name, status, capability_schema, rate_amount")
    .eq("slug", agent_b_slug)
    .eq("status", "active")
    .single();

  if (!agentB) {
    return NextResponse.json({ error: `Agent '${agent_b_slug}' not found or inactive` }, { status: 404 });
  }

  // Verify both agents have the specified capability
  // The Sparring Partner is a universal opponent — skip capability check for it
  const SPARRING_SLUG = "sparring-partner";
  const capsA = (agentA.capability_schema as Array<{ name: string; input_schema?: Record<string, unknown> }>) ?? [];
  const capsB = (agentB.capability_schema as Array<{ name: string; input_schema?: Record<string, unknown> }>) ?? [];

  if (agent_a_slug !== SPARRING_SLUG && !capsA.find((c) => c.name === capability)) {
    return NextResponse.json(
      { error: `Agent '${agent_a_slug}' does not have capability '${capability}'`, available: capsA.map((c) => c.name) },
      { status: 400 }
    );
  }

  if (agent_b_slug !== SPARRING_SLUG && !capsB.find((c) => c.name === capability)) {
    return NextResponse.json(
      { error: `Agent '${agent_b_slug}' does not have capability '${capability}'`, available: capsB.map((c) => c.name) },
      { status: 400 }
    );
  }

  // Generate synthetic prompt if none provided — uses Claude Haiku with agent's input schema
  let prompt: Record<string, unknown>;
  let prompt_text: string | undefined = rawPromptText;
  if (rawPrompt) {
    prompt = rawPrompt;
  } else {
    // Find the challenger's input schema for this capability (non-sparring agent)
    const challengerCaps = agent_a_slug === SPARRING_SLUG ? capsB : capsA;
    const capDef = challengerCaps.find((c) => c.name === capability);
    const inputSchema = capDef?.input_schema as Record<string, unknown> | undefined;

    const synthetic = await generateSyntheticPrompt(capability, inputSchema);
    prompt = synthetic.prompt;
    prompt_text = prompt_text ?? synthetic.description;
  }

  // Billing — deduct total fight cost upfront before creating match
  const costA = Number(agentA.rate_amount) || 0;
  const costB = Number(agentB.rate_amount) || 0;
  const totalCost = costA + costB;

  if (totalCost > 0) {
    const totalMillicents = Math.floor(totalCost * 100_000);
    const { error: paymentError } = await admin.rpc("settle_user_payment", {
      p_profile_id: auth.profileId,
      p_amount_millicents: totalMillicents,
    });

    if (paymentError) {
      const msg = paymentError.message ?? "";
      if (msg.includes("INSUFFICIENT_BALANCE")) {
        return NextResponse.json(
          {
            error: "Insufficient credits for arena match",
            total_cost: totalCost,
            cost_a: costA,
            cost_b: costB,
            hint: "Top up at /dashboard",
          },
          { status: 402 }
        );
      }
      return NextResponse.json({ error: "Payment failed" }, { status: 500 });
    }
  }

  // Create the match
  const { data: match, error: insertError } = await admin
    .from("arena_matches")
    .insert({
      creator_id: auth.profileId,
      org_id: auth.orgId ?? null,
      agent_a_id: agentA.id,
      agent_b_id: agentB.id,
      capability,
      prompt,
      prompt_text: prompt_text ?? null,
      challenge_id: challenge_id ?? null,
      status: "pending",
    })
    .select("id, status, capability, created_at")
    .single();

  if (insertError || !match) {
    console.error("[arena] Insert error:", insertError);
    return NextResponse.json({ error: "Failed to create match" }, { status: 500 });
  }

  // Fire Inngest event to execute the match asynchronously
  await inngest.send({
    name: "arena/match.created",
    data: { match_id: match.id },
  });

  logAuditEvent({
    orgId: auth.orgId ?? null,
    actorId: auth.profileId,
    action: "arena_match.created",
    targetType: "arena_match",
    targetId: match.id,
    metadata: { capability, agent_a: agent_a_slug, agent_b: agent_b_slug },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json(
    {
      match,
      stream_url: `/api/arena/matches/${match.id}/stream`,
      cost: totalCost > 0 ? { total: totalCost, agent_a: costA, agent_b: costB } : undefined,
    },
    { status: 201 }
  );
}

/**
 * GET /api/arena/matches — List matches (public, paginated)
 */
export async function GET(request: NextRequest) {
  const admin = createAdminClient();
  const url = new URL(request.url);

  const VALID_STATUSES = new Set(["pending", "running", "judging", "voting", "completed", "failed"]);
  const VALID_MATCH_TYPES = new Set(["undercard", "championship"]);

  const rawStatus = url.searchParams.get("status");
  const capability = url.searchParams.get("capability");
  const rawMatchType = url.searchParams.get("match_type");
  const agentSlug = url.searchParams.get("agent");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));
  const offset = (page - 1) * limit;

  // Validate enum query params — ignore invalid values
  const status = rawStatus && VALID_STATUSES.has(rawStatus) ? rawStatus : null;
  const matchType = rawMatchType && VALID_MATCH_TYPES.has(rawMatchType) ? rawMatchType : null;

  // Build query — explicit columns to avoid leaking internal data
  let query = admin
    .from("arena_matches")
    .select(
      `
      id, capability, status, match_type, level, winner,
      votes_a, votes_b, votes_tie,
      duration_a_ms, duration_b_ms,
      created_at,
      agent_a:agents!arena_matches_agent_a_id_fkey(name, slug, description),
      agent_b:agents!arena_matches_agent_b_id_fkey(name, slug, description)
      `,
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq("status", status);
  }
  if (capability) {
    query = query.eq("capability", capability);
  }
  if (matchType) {
    query = query.eq("match_type", matchType);
  }

  const { data: matches, count, error } = await query;

  if (error) {
    console.error("[arena] List matches query failed");
    return NextResponse.json({ error: "Failed to list matches" }, { status: 500 });
  }

  // If filtering by agent slug, filter client-side (join makes server-side filter complex)
  let filtered = matches ?? [];
  if (agentSlug) {
    filtered = filtered.filter(
      (m) =>
        (m.agent_a as unknown as { slug: string })?.slug === agentSlug ||
        (m.agent_b as unknown as { slug: string })?.slug === agentSlug
    );
  }

  return NextResponse.json(
    {
      matches: filtered,
      total: count ?? 0,
      page,
      limit,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30",
      },
    }
  );
}
