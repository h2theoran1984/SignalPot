import { NextRequest, NextResponse } from "next/server";
import { createAgent, type CreateAgentInput } from "@/lib/architect";

export const maxDuration = 300;

/**
 * The Architect — A2A endpoint for agent creation.
 *
 * Accepts create_agent requests via A2A JSON-RPC and orchestrates
 * the full pipeline: Intent → Schema → Prompt → Register → Smoke Test.
 */

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

  if (capability !== "create_agent") {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: (body.id as string) ?? null,
        error: {
          code: -32601,
          message: `Capability "${capability}" not supported. Available: create_agent`,
        },
      },
      { status: 400 }
    );
  }

  // Validate required input
  const description = input.description as string | undefined;
  if (!description || typeof description !== "string" || description.trim().length < 10) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: (body.id as string) ?? null,
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
      id: (body.id as string) ?? null,
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
        id: (body.id as string) ?? null,
        error: {
          code: -32000,
          message: `Agent creation failed: ${message}`,
        },
      },
      { status: 500 }
    );
  }
}
