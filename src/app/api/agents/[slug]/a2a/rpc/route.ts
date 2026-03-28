// POST /api/agents/[slug]/a2a/rpc — A2A JSON-RPC 2.0 endpoint
import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dispatchA2ARpc } from "@/lib/a2a/handler";
import { A2AErrorCodes, type JSONRPCRequest } from "@/lib/a2a/types";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

// Methods that can be called without authentication (read-only queries)
const PUBLIC_METHODS = new Set(["tasks/get"]);

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Parse JSON-RPC envelope first (before auth, so we can check if method is public)
  let rpcRequest: JSONRPCRequest;
  try {
    const body = await request.json();
    if (body.jsonrpc !== "2.0" || !body.method || body.id === undefined) {
      throw new Error("Invalid JSON-RPC request");
    }
    rpcRequest = body as JSONRPCRequest;
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: A2AErrorCodes.InvalidRequest, message: "Invalid JSON-RPC request" },
      },
      { status: 200, headers: CORS }
    );
  }

  // Auth check — required for most methods, optional for public ones
  const auth = await getAuthContext(request);
  const isPublicMethod = PUBLIC_METHODS.has(rpcRequest.method);

  if (!auth && !isPublicMethod) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: rpcRequest.id,
        error: {
          code: A2AErrorCodes.InvalidRequest,
          message: "Authentication required",
          data: {
            hint: "Provide an API key via 'Authorization: Bearer sp_live_...' header or a valid session cookie",
            supportedSchemes: ["apiKey", "bearer"],
          },
        },
      },
      { status: 401, headers: CORS }
    );
  }

  // Look up the provider agent
  const supabase = await createClient();
  const { data: agent } = await supabase
    .from("agents")
    .select("id, status, slug")
    .eq("slug", slug)
    .single();

  if (!agent || agent.status !== "active") {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: rpcRequest.id,
        error: { code: A2AErrorCodes.TaskNotFound, message: "Agent not found or inactive" },
      },
      { status: 200, headers: CORS }
    );
  }

  // For public methods without auth, use a system-level requester ID
  const requesterId = auth?.profileId ?? "anonymous";

  // Dispatch to the appropriate handler
  const response = await dispatchA2ARpc(rpcRequest, agent.id, requesterId, agent.slug);

  return NextResponse.json(response, { status: 200, headers: CORS });
}
