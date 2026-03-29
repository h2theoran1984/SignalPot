// POST /api/verify/detect — Probe an external agent endpoint to detect capabilities.
// Tries A2A agent/card, MCP spec, and health check patterns.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";

const PROBE_TIMEOUT = 10_000;

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
  if (!endpoint || !endpoint.startsWith("http")) {
    return NextResponse.json({ error: "Valid endpoint URL required" }, { status: 400 });
  }

  // Try multiple detection strategies
  const result = await detectAgent(endpoint);

  if (!result) {
    return NextResponse.json(
      { error: "Could not detect an agent at this endpoint. Make sure it's accessible and responds to A2A, MCP, or health check requests." },
      { status: 404 }
    );
  }

  return NextResponse.json(result);
}

interface DetectionResult {
  name: string;
  description: string;
  capabilities: Array<{ name: string; description?: string }>;
  a2aCompatible: boolean;
}

async function detectAgent(endpoint: string): Promise<DetectionResult | null> {
  // Strategy 1: A2A agent/card via JSON-RPC
  const a2aResult = await tryA2ADetection(endpoint);
  if (a2aResult) return a2aResult;

  // Strategy 2: Well-known agent.json
  const wellKnownResult = await tryWellKnownDetection(endpoint);
  if (wellKnownResult) return wellKnownResult;

  // Strategy 3: MCP spec endpoint
  const mcpResult = await tryMCPDetection(endpoint);
  if (mcpResult) return mcpResult;

  // Strategy 4: Simple GET health check
  const healthResult = await tryHealthCheck(endpoint);
  if (healthResult) return healthResult;

  return null;
}

async function tryA2ADetection(endpoint: string): Promise<DetectionResult | null> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "agent/card",
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const card = data.result ?? data;

    if (card.name && (card.skills || card.capabilities)) {
      const skills = card.skills as Array<{ id?: string; name: string; description?: string }> ?? [];
      return {
        name: card.name,
        description: card.description ?? "",
        capabilities: skills.map((s) => ({
          name: s.id ?? s.name,
          description: s.description,
        })),
        a2aCompatible: true,
      };
    }
  } catch { /* continue to next strategy */ }
  return null;
}

async function tryWellKnownDetection(endpoint: string): Promise<DetectionResult | null> {
  try {
    // Derive base URL from endpoint
    const url = new URL(endpoint);
    const wellKnownUrl = `${url.origin}/.well-known/agent.json`;

    const res = await fetch(wellKnownUrl, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    });

    if (!res.ok) return null;

    const card = await res.json();
    if (card.name) {
      const skills = card.skills as Array<{ id?: string; name: string; description?: string }> ?? [];
      return {
        name: card.name,
        description: card.description ?? "",
        capabilities: skills.map((s) => ({
          name: s.id ?? s.name,
          description: s.description,
        })),
        a2aCompatible: !!card.protocolVersion,
      };
    }
  } catch { /* continue */ }
  return null;
}

async function tryMCPDetection(endpoint: string): Promise<DetectionResult | null> {
  try {
    // Try GET on the endpoint for MCP spec
    const url = new URL(endpoint);
    const mcpUrl = `${url.origin}${url.pathname.replace(/\/$/, "")}/mcp`;

    const res = await fetch(mcpUrl, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    });

    if (!res.ok) return null;

    const spec = await res.json();
    if (spec.name || spec.tools) {
      const tools = spec.tools as Array<{ name: string; description?: string }> ?? [];
      return {
        name: spec.name ?? "Unknown Agent",
        description: spec.description ?? "",
        capabilities: tools.map((t) => ({
          name: t.name,
          description: t.description,
        })),
        a2aCompatible: false,
      };
    }
  } catch { /* continue */ }
  return null;
}

async function tryHealthCheck(endpoint: string): Promise<DetectionResult | null> {
  try {
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    });

    if (!res.ok) return null;

    const data = await res.json();

    // Look for common agent metadata patterns
    if (data.name || data.agent || data.status) {
      return {
        name: data.name ?? data.agent ?? "External Agent",
        description: data.description ?? "",
        capabilities: data.capabilities
          ? (data.capabilities as Array<{ name: string; description?: string }>)
          : [],
        a2aCompatible: false,
      };
    }
  } catch { /* continue */ }
  return null;
}
