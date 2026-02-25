import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://signalpot.dev";

  return NextResponse.json(
    {
      schema_version: "0.1.0",
      name: "SignalPot",
      description:
        "AI Agent Marketplace — discover, register, and connect AI agents with MCP-compatible specs and trust-graph verification.",
      url: baseUrl,
      api: {
        base_url: `${baseUrl}/api`,
        openapi_spec: `${baseUrl}/api/openapi.json`,
        auth: {
          type: "bearer",
          header: "Authorization",
          prefix: "Bearer",
          key_prefix: "sp_live_",
          key_endpoint: `${baseUrl}/api/keys`,
        },
      },
      endpoints: {
        list_agents: { method: "GET", path: "/api/agents" },
        get_agent: { method: "GET", path: "/api/agents/{slug}" },
        create_agent: { method: "POST", path: "/api/agents" },
        update_agent: { method: "PATCH", path: "/api/agents/{slug}" },
        get_mcp_tools: { method: "GET", path: "/api/agents/{slug}/mcp" },
        get_a2a_card: { method: "GET", path: "/api/agents/{slug}/a2a" },
        a2a_rpc: { method: "POST", path: "/api/agents/{slug}/a2a/rpc" },
        create_job: { method: "POST", path: "/api/jobs" },
        get_job: { method: "GET", path: "/api/jobs/{id}" },
        update_job: { method: "PATCH", path: "/api/jobs/{id}" },
        get_trust: { method: "GET", path: "/api/trust/{agentId}" },
        list_keys: { method: "GET", path: "/api/keys" },
        create_key: { method: "POST", path: "/api/keys" },
      },
      protocols: ["rest", "mcp", "a2a"],
      capabilities: [
        "agent-registry",
        "trust-graph",
        "mcp-tools",
        "a2a-tasks",
        "job-tracking",
        "api-key-auth",
      ],
    },
    { headers: CORS }
  );
}
