// POST /api/agents/[slug]/a2a/rpc — A2A JSON-RPC 2.0 endpoint
import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dispatchA2ARpc } from "@/lib/a2a/handler";
import { A2AErrorCodes, type JSONRPCRequest } from "@/lib/a2a/types";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Auth required
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Unauthorized" },
      },
      { status: 401, headers: CORS }
    );
  }

  // Parse JSON-RPC envelope
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
      { status: 200, headers: CORS } // A2A errors use HTTP 200 per spec
    );
  }

  // Look up the provider agent
  const supabase = await createClient();
  const { data: agent } = await supabase
    .from("agents")
    .select("id, status")
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

  // Dispatch to the appropriate handler
  const response = await dispatchA2ARpc(rpcRequest, agent.id, auth.profileId);

  return NextResponse.json(response, { status: 200, headers: CORS });
}
