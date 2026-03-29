import { NextRequest, NextResponse } from "next/server";
import { createAgent, type CreateAgentInput } from "@/lib/architect";
import { refineAgent, type RefineInput } from "@/lib/architect/refine";

export const maxDuration = 300;

/**
 * The Architect — A2A endpoint for agent creation and refinement.
 *
 * Capabilities:
 *   - create_agent: Intent → Schema → Prompt → Register → Smoke Test
 *   - refine_agent: Match → Judge → Rewrite → Update → Repeat
 */

const SUPPORTED_CAPABILITIES = ["create_agent", "refine_agent"];

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Parse A2A JSON-RPC format
  const rpcParams = body.params as Record<string, unknown> | undefined;
  const rpcMessage = rpcParams?.message as Record<string, unknown> | undefined;
  const parts = rpcMessage?.parts as Array<Record<string, unknown>> | undefined;
  const metadata = rpcParams?.metadata as Record<string, unknown> | undefined;

  const input = (parts?.[0]?.data ?? rpcParams?.input ?? body.input ?? {}) as Record<string, unknown>;
  const capability = (metadata?.capability_used ?? rpcParams?.capability ?? body.capability ?? "create_agent") as string;

  if (!SUPPORTED_CAPABILITIES.includes(capability)) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: (body.id as string) ?? null,
        error: {
          code: -32601,
          message: `Capability "${capability}" not supported. Available: ${SUPPORTED_CAPABILITIES.join(", ")}`,
        },
      },
      { status: 400 }
    );
  }

  const rpcId = (body.id as string) ?? null;

  if (capability === "create_agent") {
    return handleCreateAgent(input, rpcId);
  } else {
    return handleRefineAgent(input, rpcId, request);
  }
}

// ============================================================
// create_agent
// ============================================================

async function handleCreateAgent(
  input: Record<string, unknown>,
  rpcId: string | null
): Promise<NextResponse> {
  const description = input.description as string | undefined;
  if (!description || typeof description !== "string" || description.trim().length < 10) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: rpcId,
        error: {
          code: -32602,
          message: "Missing or too short 'description' field (min 10 characters)",
        },
      },
      { status: 400 }
    );
  }

  const createInput: CreateAgentInput = {
    description: description.trim(),
    model_preference: (input.model_preference as "haiku" | "sonnet" | "opus") ?? undefined,
    rate: (input.rate as number) ?? undefined,
    tags: (input.tags as string[]) ?? undefined,
    owner_id: (input.owner_id as string) ?? undefined,
  };

  try {
    const result = await createAgent(createInput);

    return NextResponse.json({
      jsonrpc: "2.0",
      id: rpcId,
      result: {
        artifacts: [
          {
            parts: [{ type: "data", data: result }],
          },
        ],
        _meta: {
          capability: "create_agent",
          agent_created: result.agent.slug,
          smoke_test_passed: result.smoke_test.passed,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[architect] create_agent failed:", message);

    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: rpcId,
        error: { code: -32000, message: `Agent creation failed: ${message}` },
      },
      { status: 500 }
    );
  }
}

// ============================================================
// refine_agent
// ============================================================

async function handleRefineAgent(
  input: Record<string, unknown>,
  rpcId: string | null,
  request: NextRequest
): Promise<NextResponse> {
  const agentSlug = input.agent_slug as string | undefined;
  if (!agentSlug || typeof agentSlug !== "string" || agentSlug.trim().length < 3) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: rpcId,
        error: {
          code: -32602,
          message: "Missing or invalid 'agent_slug' field (min 3 characters)",
        },
      },
      { status: 400 }
    );
  }

  const refineInput: RefineInput = {
    agent_slug: agentSlug.trim(),
    max_iterations: (input.max_iterations as number) ?? 10,
    target_score: (input.target_score as number) ?? 0.9,
    opponent_slug: (input.opponent_slug as string) ?? "sparring-partner",
    opponent_level: (input.opponent_level as number) ?? 1,
    capability: (input.capability as string) ?? undefined,
  };

  // Build fight URL + auth headers for internal calls
  const baseUrl = request.url.replace(/\/api\/arena\/architect.*$/, "");
  const fightUrl = `${baseUrl}/api/arena/fight`;

  const authHeaders: Record<string, string> = {};
  const authHeader = request.headers.get("authorization");
  if (authHeader) authHeaders["Authorization"] = authHeader;
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) authHeaders["Cookie"] = cookieHeader;

  try {
    const result = await refineAgent(refineInput, fightUrl, authHeaders);

    return NextResponse.json({
      jsonrpc: "2.0",
      id: rpcId,
      result: {
        artifacts: [
          {
            parts: [{ type: "data", data: result }],
          },
        ],
        _meta: {
          capability: "refine_agent",
          agent_slug: result.agent_slug,
          iterations: result.iterations_run,
          stopped_reason: result.stopped_reason,
          best_version: result.best_version,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[architect] refine_agent failed:", message);

    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: rpcId,
        error: { code: -32000, message: `Agent refinement failed: ${message}` },
      },
      { status: 500 }
    );
  }
}
