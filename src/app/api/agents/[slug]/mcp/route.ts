import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/agents/[slug]/mcp — MCP-compatible machine-readable spec
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: agent, error } = await supabase
    .from("agents")
    .select("name, slug, description, capability_schema, mcp_endpoint")
    .eq("slug", slug)
    .single();

  if (error || !agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Return in MCP ListTools response format
  const capabilities = agent.capability_schema ?? [];
  const tools = Array.isArray(capabilities)
    ? capabilities.map(
        (cap: {
          name: string;
          description: string;
          inputSchema: Record<string, unknown>;
        }) => ({
          name: `${agent.slug}/${cap.name}`,
          description: cap.description,
          inputSchema: {
            type: "object",
            ...cap.inputSchema,
          },
        })
      )
    : [];

  return NextResponse.json({
    tools,
    metadata: {
      agent_name: agent.name,
      agent_slug: agent.slug,
      description: agent.description,
      mcp_endpoint: agent.mcp_endpoint,
    },
  });
}
