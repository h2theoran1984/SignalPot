import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext, hasScope } from "@/lib/auth";
import {
  createAgentSchema,
  escapeIlike,
  stripSensitiveAgentFields,
} from "@/lib/validations";

// GET /api/agents — Search/filter agents
export async function GET(request: Request) {
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

  const supabase = await createClient();

  // Get current user for auth_config visibility
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    if (!isNaN(rate) && rate >= 0) {
      query = query.lte("rate_amount", rate);
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
  const filtered = minTrustScore
    ? agents.filter(
        (a) => a.avg_trust_score >= parseFloat(minTrustScore as string)
      )
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

  // Check agent limit per user (max 50)
  const { count } = await auth.supabase
    .from("agents")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", auth.profileId);

  if (count !== null && count >= 50) {
    return NextResponse.json(
      { error: "Agent limit reached (max 50 per user)" },
      { status: 429 }
    );
  }

  const { data, error } = await auth.supabase
    .from("agents")
    .insert({
      owner_id: auth.profileId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      capability_schema: input.capability_schema,
      rate_type: input.rate_type,
      rate_amount: input.rate_amount,
      rate_currency: input.rate_currency,
      auth_type: input.auth_type,
      auth_config: input.auth_config,
      mcp_endpoint: input.mcp_endpoint ?? null,
      tags: input.tags,
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

  return NextResponse.json(data, { status: 201 });
}
