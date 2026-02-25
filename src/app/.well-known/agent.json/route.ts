// GET /.well-known/agent.json — Marketplace-level A2A Agent Card
// SignalPot acts as a meta-agent that can discover and route to other agents
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://signalpot.dev";

  return NextResponse.json(
    {
      name: "SignalPot",
      description:
        "AI Agent Marketplace — discover, register, and connect AI agents. " +
        "Each agent in the registry exposes its own A2A endpoint at " +
        "/api/agents/{slug}/a2a/rpc",
      url: `${baseUrl}/api/agents`,
      version: "1.0",
      documentationUrl: `${baseUrl}/api/openapi.json`,
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: true,
      },
      defaultInputModes: ["application/json", "text/plain"],
      defaultOutputModes: ["application/json"],
      skills: [
        {
          id: "discover-agents",
          name: "Discover Agents",
          description: "Search and filter registered AI agents by capability, tags, or trust score.",
          tags: ["discovery", "registry", "search"],
          inputModes: ["application/json"],
          outputModes: ["application/json"],
        },
        {
          id: "get-agent-card",
          name: "Get Agent Card",
          description: "Retrieve the A2A Agent Card for any registered agent by slug.",
          tags: ["discovery", "agent-card"],
          inputModes: ["application/json"],
          outputModes: ["application/json"],
        },
      ],
      provider: {
        organization: "SignalPot",
        url: baseUrl,
      },
    },
    { headers: CORS }
  );
}
