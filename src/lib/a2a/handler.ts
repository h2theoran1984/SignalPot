// A2A JSON-RPC 2.0 handler
// Maps A2A protocol methods onto SignalPot's existing jobs infrastructure

import { createAdminClient } from "@/lib/supabase/admin";
import {
  A2AErrorCodes,
  type AgentCard,
  type JSONRPCErrorResponse,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCSuccessResponse,
  type Message,
  type MessageSendParams,
  type Task,
  type TaskIdParams,
  type TaskQueryParams,
  type TaskState,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function success<T>(id: string | number, result: T): JSONRPCSuccessResponse<T> {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JSONRPCErrorResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

// Map our job statuses to A2A TaskState
function jobStatusToTaskState(
  status: string,
  verified: boolean
): TaskState {
  switch (status) {
    case "pending":  return "submitted";
    case "running":  return "working";
    case "completed": return verified ? "completed" : "completed";
    case "failed":   return "failed";
    default:         return "unknown";
  }
}

// Build an A2A Task from a DB job row
function jobToTask(job: Record<string, unknown>): Task {
  const state = jobStatusToTaskState(
    job.status as string,
    job.verified as boolean
  );

  const messages: Message[] = [];

  if (job.input_summary) {
    messages.push({
      kind: "message",
      role: "user",
      parts: [{ kind: "data", data: job.input_summary as Record<string, unknown> }],
      taskId: job.id as string,
      contextId: job.id as string,
    });
  }

  if (job.output_summary && (state === "completed" || state === "failed")) {
    messages.push({
      kind: "message",
      role: "agent",
      parts: [{ kind: "data", data: job.output_summary as Record<string, unknown> }],
      taskId: job.id as string,
      contextId: job.id as string,
    });
  }

  return {
    kind: "task",
    id: job.id as string,
    contextId: job.id as string,
    status: {
      state,
      timestamp: (job.updated_at ?? job.created_at) as string,
    },
    history: messages,
    metadata: {
      provider_agent_id: job.provider_agent_id,
      requester_agent_id: job.requester_agent_id,
      capability_used: job.capability_used,
      cost: job.cost,
      duration_ms: job.duration_ms,
      job_type: job.job_type,
    },
  };
}

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

async function handleMessageSend(
  id: string | number,
  params: unknown,
  providerAgentId: string,
  requesterId: string
): Promise<JSONRPCResponse<Task | Message>> {
  const p = params as MessageSendParams;
  if (!p?.message) {
    return rpcError(id, A2AErrorCodes.InvalidParams, "params.message is required");
  }

  const supabase = createAdminClient();

  // Extract input data from the message parts
  const inputSummary: Record<string, unknown> = {};
  for (const part of p.message.parts ?? []) {
    if (part.kind === "text") inputSummary.text = part.text;
    if (part.kind === "data") Object.assign(inputSummary, part.data);
  }

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      provider_agent_id: providerAgentId,
      requester_profile_id: requesterId,
      job_type: "production",
      capability_used: p.metadata?.capability_used as string ?? null,
      input_summary: Object.keys(inputSummary).length ? inputSummary : null,
      status: "pending",
      cost: 0,
      verified: false,
    })
    .select()
    .single();

  if (error || !job) {
    return rpcError(id, A2AErrorCodes.InternalError, "Failed to create task");
  }

  return success(id, jobToTask(job));
}

async function handleTasksGet(
  id: string | number,
  params: unknown
): Promise<JSONRPCResponse<Task>> {
  const p = params as TaskQueryParams;
  if (!p?.id) {
    return rpcError(id, A2AErrorCodes.InvalidParams, "params.id is required");
  }

  const supabase = createAdminClient();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", p.id)
    .single();

  if (error || !job) {
    return rpcError(id, A2AErrorCodes.TaskNotFound, `Task ${p.id} not found`);
  }

  return success(id, jobToTask(job));
}

async function handleTasksCancel(
  id: string | number,
  params: unknown,
  requesterId: string
): Promise<JSONRPCResponse<Task>> {
  const p = params as TaskIdParams;
  if (!p?.id) {
    return rpcError(id, A2AErrorCodes.InvalidParams, "params.id is required");
  }

  const supabase = createAdminClient();

  // Check the job exists and requester owns it
  const { data: job } = await supabase
    .from("jobs")
    .select("*, provider_agent:agents!jobs_provider_agent_id_fkey(owner_id)")
    .eq("id", p.id)
    .single();

  if (!job) {
    return rpcError(id, A2AErrorCodes.TaskNotFound, `Task ${p.id} not found`);
  }

  if (job.status === "completed" || job.status === "failed") {
    return rpcError(id, A2AErrorCodes.TaskNotCancelable, "Task is already in a terminal state");
  }

  const ownerCheck =
    job.requester_profile_id === requesterId ||
    job.provider_agent?.owner_id === requesterId;

  if (!ownerCheck) {
    return rpcError(id, A2AErrorCodes.UnsupportedOperation, "Not authorized to cancel this task");
  }

  const { data: updated } = await supabase
    .from("jobs")
    .update({ status: "failed" })
    .eq("id", p.id)
    .select()
    .single();

  return success(id, jobToTask(updated ?? job));
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function dispatchA2ARpc(
  request: JSONRPCRequest,
  providerAgentId: string,
  requesterId: string
): Promise<JSONRPCResponse> {
  const { id, method, params } = request;

  switch (method) {
    case "message/send":
      return handleMessageSend(id, params, providerAgentId, requesterId);

    case "tasks/get":
      return handleTasksGet(id, params);

    case "tasks/cancel":
      return handleTasksCancel(id, params, requesterId);

    default:
      return rpcError(id, A2AErrorCodes.MethodNotFound, `Method '${method}' not found`);
  }
}

// ---------------------------------------------------------------------------
// Agent Card builder
// ---------------------------------------------------------------------------

export function buildAgentCard(
  agent: Record<string, unknown>,
  baseUrl: string
): AgentCard {
  const capabilities = (agent.capability_schema as Array<Record<string, unknown>>) ?? [];

  return {
    name: agent.name as string,
    description: (agent.description as string) ?? undefined,
    url: `${baseUrl}/api/agents/${agent.slug}/a2a/rpc`,
    version: "1.0",
    documentationUrl: `${baseUrl}/agents/${agent.slug}`,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: capabilities.map((cap) => ({
      id: cap.name as string,
      name: cap.name as string,
      description: (cap.description as string) ?? undefined,
      tags: (agent.tags as string[]) ?? [],
      inputModes: ["application/json"],
      outputModes: ["application/json"],
    })),
    provider: {
      organization: "SignalPot",
      url: baseUrl,
    },
  };
}
