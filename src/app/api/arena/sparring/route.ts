import { NextRequest, NextResponse } from "next/server";
import { handleSparringRequest, SPARRING_PARTNER_CONFIG } from "@/lib/arena/sparring-partner";

/**
 * POST /api/arena/sparring — The Sparring Partner's A2A RPC endpoint.
 *
 * The arena engine calls this like any other agent endpoint.
 * It lives inside the main app — no external deployment needed.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // JSON-RPC 2.0 envelope
    if (body?.jsonrpc !== "2.0") {
      return NextResponse.json(
        { jsonrpc: "2.0", id: 0, error: { code: -32600, message: "Invalid JSON-RPC request" } },
        { status: 400 }
      );
    }

    const id = body.id ?? 0;

    if (body.method === "message/send") {
      const params = body.params as {
        message: { parts: Array<{ type: string; text?: string; data?: Record<string, unknown> }> };
        metadata?: { capability_used?: string };
      };

      // Extract capability
      const capability = params.metadata?.capability_used ?? "summarize";

      // Extract input from message parts
      const dataPart = params.message.parts.find((p) => p.type === "data");
      const textPart = params.message.parts.find((p) => p.type === "text");

      let input: Record<string, unknown>;

      if (dataPart && "data" in dataPart && dataPart.data) {
        input = dataPart.data;
      } else if (textPart && "text" in textPart && textPart.text) {
        try {
          input = JSON.parse(textPart.text);
        } catch {
          input = { text: textPart.text };
        }
      } else {
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "No input data found in message parts" },
        });
      }

      // Handle the capability
      const { data, cost } = await handleSparringRequest(capability, input);

      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          id: crypto.randomUUID(),
          status: { state: "completed" },
          artifacts: [{ parts: [{ type: "data", data }] }],
          _meta: {
            provider_cost: {
              api_cost_usd: cost.api_cost_usd,
              input_tokens: cost.input_tokens,
              output_tokens: cost.output_tokens,
            },
          },
        },
      });
    }

    if (body.method === "agent/card") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          name: SPARRING_PARTNER_CONFIG.name,
          description: SPARRING_PARTNER_CONFIG.description,
          capabilities: SPARRING_PARTNER_CONFIG.capabilities,
        },
      });
    }

    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    });
  } catch (err) {
    console.error("[arena-sparring] Request failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({
      jsonrpc: "2.0",
      id: 0,
      error: { code: -32603, message: "Internal error" },
    });
  }
}

/** GET /api/arena/sparring — health check */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    agent: "sparring-partner",
    version: "0.1.0",
    capabilities: SPARRING_PARTNER_CONFIG.capabilities,
  });
}
