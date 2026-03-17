import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext, hasScope, checkPublicRateLimit } from "@/lib/auth";
import {
  createAgentSchema,
  escapeIlike,
  stripSensitiveAgentFields,
  agentIdentityRequired,
} from "@/lib/validations";
import { getAgentLimitForPlan, type Plan } from "@/lib/plans";
import { canManageAgent } from "@/lib/rbac";
import { logAuditEvent, getClientIp } from "@/lib/audit";

// GET /api/agents — Search/filter agents
export async function GET(request: Request) {
  const rateLimited = await checkPublicRateLimit(request);
  if (rateLimited) return rateLimited;

  const { searchParams } = new URL(request.url);
  const capability = searchParams.get("capability");
  const tags = searchParams.get("tags");
  const minTrustScore = searchParams.get("min_trust_score");
  const maxRate = searchParams.get("max_rate");
  const status = searchParams.get("status");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1") || 1);
  const limit = Math.min(
    Math.max(1, parseInt(searchParams.get("limit") ?? "20") || 20),
    100
  );
  const offset = (page - 1) * limit;

  // Sprint 12 constraint params
  const minTrust = searchParams.get("min_trust");           // alias / constraint-flavoured filter
  const requiredTags = searchParams.get("required_tags");   // comma-sep, agent must have ALL
  const blockedAgents = searchParams.get("blocked_agents"); // comma-sep slugs to exclude
  const maxCost = searchParams.get("max_cost");             // upper bound on rate_amount
  const visibility = searchParams.get("visibility");         // 'public' (default), 'private', or 'all'
  const parentAgentId = searchParams.get("parent_agent_id"); // filter children of a suite
  const listingType = searchParams.get("listing_type");       // 'standard' or 'suite'

  const supabase = await createClient();

  // Get current user for auth_config visibility
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Resolve org context for private agent access
  let authCtx: Awaited<ReturnType<typeof getAuthContext>> = null;
  if (visibility === "private" || visibility === "all") {
    authCtx = await getAuthContext(request);
  }

  let query = supabase
    .from("agents")
    .select("*, trust_edges!trust_edges_target_agent_id_fkey(trust_score)", {
      count: "exact",
    });

  // Validate status enum
  const validStatuses = ["active", "inactive", "deprecated"];
  if (status && validStatuses.includes(status)) {
    query = query.eq("status", status);
  } else {
    query = query.eq("status", "active");
  }

  // Visibility filter: only applied when explicitly requested
  // (the column won't exist until migration 00026 is run)
  if (visibility === "private") {
    // Show only private agents for the user's org
    if (!authCtx?.orgId) {
      return NextResponse.json(
        { error: "Org context required to view private agents" },
        { status: 400 }
      );
    }
    query = query.eq("visibility", "private").eq("org_id", authCtx.orgId);
  } else if (visibility === "all") {
    // Show public + the user's org private agents (RLS handles access control)
    if (authCtx?.orgId) {
      query = query.or(`visibility.eq.public,and(visibility.eq.private,org_id.eq.${authCtx.orgId})`);
    } else {
      query = query.eq("visibility", "public");
    }
  } else if (visibility === "public") {
    query = query.eq("visibility", "public");
  }
  // When visibility param is omitted, no filter applied — shows all accessible agents (RLS handles private)

  // Suite filters
  if (parentAgentId) {
    query = query.eq("parent_agent_id", parentAgentId);
  }
  if (listingType === "standard" || listingType === "suite") {
    query = query.eq("listing_type", listingType);
  }

  if (tags) {
    const tagArray = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);
    if (tagArray.length > 0) {
      query = query.overlaps("tags", tagArray);
    }
  }

  if (capability) {
    const escaped = escapeIlike(capability.slice(0, 200));
    query = query.ilike("capability_schema", `%${escaped}%`);
  }

  if (maxRate) {
    const rate = parseFloat(maxRate);
    if (Number.isFinite(rate) && rate >= 0) {
      query = query.lte("rate_amount", rate);
    }
  }

  // Sprint 12: required_tags — agent must contain ALL specified tags (contains, not just overlap)
  if (requiredTags) {
    const reqTagArray = requiredTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);
    if (reqTagArray.length > 0) {
      query = query.contains("tags", reqTagArray);
    }
  }

  // Sprint 12: blocked_agents — exclude agents with these slugs
  if (blockedAgents) {
    const blockedArray = blockedAgents
      .split(",")
      .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9-]/g, ""))
      .filter(Boolean)
      .slice(0, 50);
    if (blockedArray.length > 0) {
      for (const slug of blockedArray) {
        query = query.neq("slug", slug);
      }
    }
  }

  // Sprint 12: max_cost — upper bound on rate_amount (stricter alias alongside max_rate)
  if (maxCost) {
    const cost = parseFloat(maxCost);
    if (Number.isFinite(cost) && cost >= 0) {
      query = query.lte("rate_amount", cost);
    }
  }

  query = query.order("created_at", { ascending: false });
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch agents" },
      { status: 500 }
    );
  }

  // Compute average trust score per agent, strip sensitive fields
  const agents = (data ?? []).map((agent) => {
    const edges = agent.trust_edges ?? [];
    const avgTrust =
      edges.length > 0
        ? edges.reduce(
            (sum: number, e: { trust_score: number }) => sum + e.trust_score,
            0
          ) / edges.length
        : 0;

    const { trust_edges: _, ...rest } = agent;
    const safe = stripSensitiveAgentFields(rest, user?.id);
    return { ...safe, avg_trust_score: avgTrust };
  });

  // Filter by min trust score client-side (after aggregation)
  // Both min_trust_score (legacy) and min_trust (Sprint 12 constraint) use the same logic.
  // Apply the stricter of the two if both are provided.
  const parsedMinTrustScore = minTrustScore ? parseFloat(minTrustScore) : 0;
  const parsedMinTrust = minTrust ? parseFloat(minTrust) : 0;
  const minTrustThreshold = Math.max(
    Number.isFinite(parsedMinTrustScore) ? parsedMinTrustScore : 0,
    Number.isFinite(parsedMinTrust) ? parsedMinTrust : 0
  );

  const filtered =
    minTrustThreshold > 0
      ? agents.filter((a) => a.avg_trust_score >= minTrustThreshold)
      : agents;

  return NextResponse.json({
    agents: filtered,
    total: count,
    page,
    limit,
  });
}

// POST /api/agents — Register new agent (auth required)
export async function POST(request: Request) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasScope(auth, "agents:write")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = createAgentSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const input = result.data;

  // Grace period enforcement for agent identity fields
  if (agentIdentityRequired() && (!input.goal || !input.decision_logic)) {
    return NextResponse.json(
      { error: "Agents must include 'goal' and 'decision_logic' fields to be listed on SignalPot" },
      { status: 400 }
    );
  }
  if (!input.goal || !input.decision_logic) {
    console.warn(`[agents] Registration without goal/decision_logic — slug: ${input.slug}`);
  }

  // Private agents must belong to an org
  if (input.visibility === "private" && !auth.orgId) {
    return NextResponse.json(
      { error: "Private agents must belong to an organization" },
      { status: 400 }
    );
  }

  // Org context: if creating an org agent, verify permissions
  const orgId = auth.orgId;
  if (orgId) {
    const allowed = canManageAgent(auth, { owner_id: auth.profileId, org_id: orgId });
    if (!allowed) {
      return NextResponse.json(
        { error: "Requires developer+ role to create org agents" },
        { status: 403 }
      );
    }
  }

  // Validate parent_agent_id references an active suite owned by same user/org
  if (input.parent_agent_id) {
    const { data: parentAgent } = await auth.supabase
      .from("agents")
      .select("id, listing_type, owner_id, org_id")
      .eq("id", input.parent_agent_id)
      .single();

    if (!parentAgent || parentAgent.listing_type !== "suite") {
      return NextResponse.json(
        { error: "parent_agent_id must reference an existing suite agent" },
        { status: 400 }
      );
    }

    const sameOwner = parentAgent.owner_id === auth.profileId;
    const sameOrg = orgId && parentAgent.org_id === orgId;
    if (!sameOwner && !sameOrg) {
      return NextResponse.json(
        { error: "Cannot add sub-agent to a suite you don't own" },
        { status: 403 }
      );
    }
  }

  // Check agent limit — personal agents count per user, org agents count per org
  if (orgId) {
    const { count } = await auth.supabase
      .from("agents")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);

    // Org uses team plan limits
    const agentLimit = getAgentLimitForPlan("team");
    if (count !== null && count >= agentLimit) {
      return NextResponse.json(
        { error: `Org agent limit reached (${agentLimit} agents max)` },
        { status: 429 }
      );
    }
  } else {
    const { count } = await auth.supabase
      .from("agents")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", auth.profileId)
      .is("org_id", null);

    const { data: profile } = await auth.supabase
      .from("profiles")
      .select("plan")
      .eq("id", auth.profileId)
      .single();

    const plan = ((profile?.plan as Plan) ?? "free") as Plan;
    const agentLimit = getAgentLimitForPlan(plan);

    if (count !== null && count >= agentLimit) {
      return NextResponse.json(
        {
          error: `Agent limit reached (${agentLimit} agents max on the ${plan} plan — upgrade to add more)`,
        },
        { status: 429 }
      );
    }
  }

  const { data, error } = await auth.supabase
    .from("agents")
    .insert({
      owner_id: auth.profileId,
      org_id: orgId ?? null,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      goal: input.goal ?? null,
      decision_logic: input.decision_logic ?? null,
      agent_type: input.agent_type,
      capability_schema: input.capability_schema,
      rate_type: input.rate_type,
      rate_amount: input.rate_amount,
      rate_currency: input.rate_currency,
      auth_type: input.auth_type,
      auth_config: input.auth_config,
      mcp_endpoint: input.mcp_endpoint ?? null,
      tags: input.tags,
      visibility: input.visibility,
      listing_type: input.listing_type,
      parent_agent_id: input.parent_agent_id ?? null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "An agent with this slug already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create agent" },
      { status: 500 }
    );
  }

  logAuditEvent({
    orgId: orgId ?? null,
    actorId: auth.profileId,
    action: "agent.created",
    targetType: "agent",
    targetId: data.id,
    metadata: { slug: input.slug, name: input.name },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json(data, { status: 201 });
}
