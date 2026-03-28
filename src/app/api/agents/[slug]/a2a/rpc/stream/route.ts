// POST /api/agents/[slug]/a2a/rpc/stream — A2A SSE streaming endpoint
// Handles message/stream and tasks/resubscribe via Server-Sent Events
import { getAuthContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dispatchA2ARpc } from "@/lib/a2a/handler";
import {
  A2AErrorCodes,
  type JSONRPCRequest,
  type Task,
  type TaskStatusUpdateEvent,
  type TaskArtifactUpdateEvent,
  type TaskState,
} from "@/lib/a2a/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min max for streaming

/** Validate request origin against allowed origins. */
function getAllowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.signalpot.dev";
  const allowed = [
    siteUrl,
    "https://signalpot.dev",
    "https://www.signalpot.dev",
    ...(process.env.NODE_ENV === "development" ? ["http://localhost:3000", "http://localhost:3002"] : []),
  ];
  return allowed.includes(origin) ? origin : null;
}

function sseEvent(data: unknown, eventId?: string): string {
  let out = "";
  if (eventId) out += `id: ${eventId}\n`;
  out += `data: ${JSON.stringify(data)}\n\n`;
  return out;
}

function sseError(id: string | number | null, code: number, message: string): string {
  return sseEvent({ jsonrpc: "2.0", id, error: { code, message } });
}

const JOB_STATUS_TO_TASK_STATE: Record<string, TaskState> = {
  pending: "submitted",
  running: "working",
  completed: "completed",
  failed: "failed",
  canceled: "canceled",
};

const TERMINAL_STATES = new Set(["completed", "failed", "canceled", "rejected"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const auth = await getAuthContext(request);
  if (!auth) {
    return new Response(
      sseError(null, -32600, "Unauthorized"),
      { status: 401, headers: { "Content-Type": "text/event-stream" } }
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

  const method = rpcRequest.method;

  // Handle tasks/resubscribe — resume streaming for an existing task
  if (method === "tasks/resubscribe") {
    const taskParams = rpcRequest.params as { id?: string } | undefined;
    if (!taskParams?.id) {
      return new Response(
        sseError(rpcRequest.id, A2AErrorCodes.InvalidParams, "params.id is required for resubscribe"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    }
    return createTaskStream(supabase, rpcRequest.id, taskParams.id, request);
  }

  // Handle message/stream — create task then stream
  if (method === "message/stream") {
    const sendRequest = { ...rpcRequest, method: "message/send" };
    const result = await dispatchA2ARpc(sendRequest, agent.id, auth.profileId);

    if ("error" in result) {
      return new Response(
        sseEvent(result),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    }

    const task = result.result as Task;
    return createTaskStream(supabase, rpcRequest.id, task.id, request);
  }

  // Unsupported method for streaming
  return new Response(
    sseError(rpcRequest.id, A2AErrorCodes.MethodNotFound, `Method '${method}' not supported on stream endpoint`),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
}

/**
 * Create an SSE stream that monitors a task until it reaches a terminal state.
 * Polls the database at increasing intervals to balance responsiveness with efficiency.
 */
function createTaskStream(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rpcId: string | number,
  taskId: string,
  request: Request
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const encode = (s: string) => new TextEncoder().encode(s);
      let eventSeq = 0;

      try {
        let lastState = "";
        let lastOutputHash = "";
        let attempts = 0;
        const maxAttempts = 280; // ~4.5 min at 1s intervals

        // Emit initial state
        const { data: initialJob } = await supabase
          .from("jobs")
          .select("status, verified, output_summary, updated_at, context_id")
          .eq("id", taskId)
          .single();

        if (!initialJob) {
          controller.enqueue(encode(sseError(rpcId, A2AErrorCodes.TaskNotFound, `Task ${taskId} not found`)));
          controller.close();
          return;
        }

        const initialState = JOB_STATUS_TO_TASK_STATE[initialJob.status] ?? "unknown";
        lastState = initialState;

        const contextId = (initialJob.context_id as string) ?? taskId;

        const submittedEvent: TaskStatusUpdateEvent = {
          kind: "status-update",
          taskId,
          contextId,
          status: { state: initialState, timestamp: initialJob.updated_at as string },
          final: TERMINAL_STATES.has(initialState),
        };
        controller.enqueue(encode(sseEvent(
          { jsonrpc: "2.0", id: rpcId, result: submittedEvent },
          `${eventSeq++}`
        )));

        if (TERMINAL_STATES.has(initialState)) {
          // Emit artifact if completed with output
          if (initialState === "completed" && initialJob.output_summary) {
            emitArtifact(controller, encode, rpcId, taskId, contextId, initialJob.output_summary as Record<string, unknown>, eventSeq++);
          }
          controller.close();
          return;
        }

        // Poll loop
        const poll = async () => {
          if (attempts >= maxAttempts) {
            const timeoutEvent: TaskStatusUpdateEvent = {
              kind: "status-update",
              taskId,
              contextId,
              status: { state: "failed", timestamp: new Date().toISOString() },
              final: true,
            };
            controller.enqueue(encode(sseEvent(
              { jsonrpc: "2.0", id: rpcId, result: timeoutEvent },
              `${eventSeq++}`
            )));
            controller.close();
            return;
          }

          const { data: job } = await supabase
            .from("jobs")
            .select("status, verified, output_summary, updated_at")
            .eq("id", taskId)
            .single();

          if (!job) { controller.close(); return; }

          const currentState = JOB_STATUS_TO_TASK_STATE[job.status] ?? "unknown";
          const terminal = TERMINAL_STATES.has(currentState);
          const outputHash = job.output_summary ? JSON.stringify(job.output_summary).length.toString() : "";

          // Emit status update on state change
          if (currentState !== lastState) {
            lastState = currentState;
            const updateEvent: TaskStatusUpdateEvent = {
              kind: "status-update",
              taskId,
              contextId,
              status: {
                state: currentState,
                timestamp: job.updated_at as string,
              },
              final: terminal,
            };
            controller.enqueue(encode(sseEvent(
              { jsonrpc: "2.0", id: rpcId, result: updateEvent },
              `${eventSeq++}`
            )));
          }

          // Emit artifact update when output changes
          if (outputHash && outputHash !== lastOutputHash) {
            lastOutputHash = outputHash;
            emitArtifact(controller, encode, rpcId, taskId, contextId, job.output_summary as Record<string, unknown>, eventSeq++);
          }

          if (terminal) {
            controller.close();
            return;
          }

          attempts++;
          setTimeout(poll, 1000);
        };

        setTimeout(poll, 500);
      } catch {
        controller.enqueue(encode(sseError(rpcId, A2AErrorCodes.InternalError, "Internal error")));
        controller.close();
      }
    },
  });

  const corsOrigin = getAllowedOrigin(request);
  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  };
  if (corsOrigin) {
    headers["Access-Control-Allow-Origin"] = corsOrigin;
    headers["Vary"] = "Origin";
  }

  return new Response(stream, { status: 200, headers });
}

/** Emit a TaskArtifactUpdateEvent for output data. */
function emitArtifact(
  controller: ReadableStreamDefaultController,
  encode: (s: string) => Uint8Array,
  rpcId: string | number,
  taskId: string,
  contextId: string,
  outputSummary: Record<string, unknown>,
  eventSeq: number
): void {
  // Strip internal envelope from output
  const { _envelope, _error, ...cleanOutput } = outputSummary;

  if (Object.keys(cleanOutput).length === 0) return;

  const artifactEvent: TaskArtifactUpdateEvent = {
    kind: "artifact-update",
    taskId,
    contextId,
    artifact: {
      artifactId: `${taskId}-output`,
      name: "Agent Response",
      parts: [{ kind: "data", data: cleanOutput }],
    },
    append: false,
    lastChunk: true,
  };

  controller.enqueue(encode(sseEvent(
    { jsonrpc: "2.0", id: rpcId, result: artifactEvent },
    `${eventSeq}`
  )));
}
