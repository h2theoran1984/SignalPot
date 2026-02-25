import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/agents — Search/filter agents
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const capability = searchParams.get("capability");
  const tags = searchParams.get("tags");
  const minTrustScore = searchParams.get("min_trust_score");
  const maxRate = searchParams.get("max_rate");
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20"), 100);
  const offset = (page - 1) * limit;

  const supabase = await createClient();

  let query = supabase
    .from("agents")
    .select("*, trust_edges!trust_edges_target_agent_id_fkey(trust_score)", {
      count: "exact",
    });

  if (status) {
    query = query.eq("status", status);
  } else {
    query = query.eq("status", "active");
  }

  if (tags) {
    const tagArray = tags.split(",").map((t) => t.trim());
    query = query.overlaps("tags", tagArray);
  }

  if (capability) {
    query = query.ilike("capability_schema", `%${capability}%`);
  }

  if (maxRate) {
    query = query.lte("rate_amount", parseFloat(maxRate));
  }

  query = query.order("created_at", { ascending: false });
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Compute average trust score per agent
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
    return { ...rest, avg_trust_score: avgTrust };
  });

  // Filter by min trust score client-side (after aggregation)
  const filtered = minTrustScore
    ? agents.filter((a) => a.avg_trust_score >= parseFloat(minTrustScore))
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  const {
    name,
    slug,
    description,
    capability_schema,
    rate_type,
    rate_amount,
    rate_currency,
    auth_type,
    auth_config,
    mcp_endpoint,
    tags,
  } = body;

  if (!name || !slug) {
    return NextResponse.json(
      { error: "name and slug are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("agents")
    .insert({
      owner_id: user.id,
      name,
      slug,
      description: description ?? null,
      capability_schema: capability_schema ?? [],
      rate_type: rate_type ?? "per_call",
      rate_amount: rate_amount ?? 0,
      rate_currency: rate_currency ?? "USD",
      auth_type: auth_type ?? "none",
      auth_config: auth_config ?? {},
      mcp_endpoint: mcp_endpoint ?? null,
      tags: tags ?? [],
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
