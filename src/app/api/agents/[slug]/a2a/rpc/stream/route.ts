// POST /api/agents/[slug]/a2a/rpc/stream — A2A SSE streaming endpoint
// Handles message/stream and tasks/resubscribe via Server-Sent Events
import { getAuthContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dispatchA2ARpc } from "@/lib/a2a/handler";
import { A2AErrorCodes, type JSONRPCRequest, type Task, type TaskStatusUpdateEvent } from "@/lib/a2a/types";

export const dynamic = "force-dynamic";

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function sseError(id: string | number | null, code: number, message: string): string {
  return sseEvent({ jsonrpc: "2.0", id, error: { code, message } });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const auth = await getAuthContext(request);
  if (!auth) {
    return new Response(
      sseError(null, -32600, "Unauthorized"),
      {
        status: 401,
        headers: { "Content-Type": "text/event-stream" },
      }
    );
  }

  let rpcRequest: JSONRPCRequest;
  try {
    const body = await request.json();
    if (body.jsonrpc !== "2.0" || !body.method || body.id === undefined) {
      throw new Error("Invalid JSON-RPC request");
    }
    rpcRequest = body as JSONRPCRequest;
  } catch {
    return new Response(
      sseError(null, A2AErrorCodes.InvalidRequest, "Invalid JSON-RPC request"),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
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
    return new Response(
      sseError(rpcRequest.id, A2AErrorCodes.TaskNotFound, "Agent not found or inactive"),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  // Map message/stream → message/send then stream status updates
  const sendMethod = rpcRequest.method === "message/stream" ? "message/send" : rpcRequest.method;
  const sendRequest = { ...rpcRequest, method: sendMethod };

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (s: string) => new TextEncoder().encode(s);

      try {
        // Execute the underlying action (creates job)
        const result = await dispatchA2ARpc(sendRequest, agent.id, auth.profileId);

        if ("error" in result) {
          controller.enqueue(encode(sseEvent(result)));
          controller.close();
          return;
        }

        const task = result.result as Task;

        // Emit initial submitted state
        const submittedEvent: TaskStatusUpdateEvent = {
          kind: "status-update",
          taskId: task.id,
          contextId: task.contextId,
          status: { state: "submitted", timestamp: new Date().toISOString() },
          final: false,
        };
        controller.enqueue(encode(sseEvent({ jsonrpc: "2.0", id: rpcRequest.id, result: submittedEvent })));

        // Poll for status changes (simplified — real impl would use DB subscriptions)
        let attempts = 0;
        const maxAttempts = 30; // 30s max
        let lastState = "submitted";

        const poll = async () => {
          if (attempts >= maxAttempts) {
            const timeoutEvent: TaskStatusUpdateEvent = {
              kind: "status-update",
              taskId: task.id,
              contextId: task.contextId,
              status: { state: "unknown", timestamp: new Date().toISOString() },
              final: true,
            };
            controller.enqueue(encode(sseEvent({ jsonrpc: "2.0", id: rpcRequest.id, result: timeoutEvent })));
            controller.close();
            return;
          }

          const { data: job } = await supabase
            .from("jobs")
            .select("status, verified, output_summary, updated_at")
            .eq("id", task.id)
            .single();

          if (!job) { controller.close(); return; }

          const stateMap: Record<string, string> = {
            pending: "submitted", running: "working",
            completed: "completed", failed: "failed",
          };
          const currentState = stateMap[job.status] ?? "unknown";
          const terminal = ["completed", "failed", "canceled", "rejected"].includes(currentState);

          if (currentState !== lastState || terminal) {
            lastState = currentState;
            const updateEvent: TaskStatusUpdateEvent = {
              kind: "status-update",
              taskId: task.id,
              contextId: task.contextId,
              status: { state: currentState as TaskStatusUpdateEvent["status"]["state"], timestamp: job.updated_at },
              final: terminal,
            };
            controller.enqueue(encode(sseEvent({ jsonrpc: "2.0", id: rpcRequest.id, result: updateEvent })));

            if (terminal) { controller.close(); return; }
          }

          attempts++;
          setTimeout(poll, 1000);
        };

        setTimeout(poll, 500);
      } catch {
        controller.enqueue(encode(sseError(rpcRequest.id, A2AErrorCodes.InternalError, "Internal error")));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
