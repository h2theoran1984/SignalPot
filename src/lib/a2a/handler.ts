// A2A JSON-RPC 2.0 handler
// Maps A2A protocol methods onto SignalPot's existing jobs infrastructure

import { createAdminClient } from "@/lib/supabase/admin";
import { wrapRequest } from "@/lib/envelope";
import {
  A2AErrorCodes,
  type AgentCard,
  type JSONRPCErrorResponse,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCSuccessResponse,
  type Message,
  type MessageSendParams,
  type PushNotificationConfig,
  type PushNotificationConfigParams,
  type PushNotificationConfigQueryParams,
  type PushNotificationConfigListParams,
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
    case "canceled": return "canceled";
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
  const taskId = job.id as string;
  const contextId = (job.context_id as string) ?? taskId;

  // Strip internal envelope from summaries for the message history
  const inputData = job.input_summary as Record<string, unknown> | null;
  const outputData = job.output_summary as Record<string, unknown> | null;

  if (inputData) {
    const { _envelope, ...cleanInput } = inputData;
    if (Object.keys(cleanInput).length > 0) {
      messages.push({
        kind: "message",
        role: "user",
        parts: [{ kind: "data", data: cleanInput }],
        taskId,
        contextId,
        metadata: { timestamp: job.created_at as string },
      });
    }
  }

  if (outputData && (state === "completed" || state === "failed")) {
    const { _envelope, _error, ...cleanOutput } = outputData;
    if (_error) {
      messages.push({
        kind: "message",
        role: "agent",
        parts: [{ kind: "text", text: _error as string }],
        taskId,
        contextId,
        metadata: { timestamp: (job.completed_at ?? job.updated_at) as string },
      });
    } else if (Object.keys(cleanOutput).length > 0) {
      messages.push({
        kind: "message",
        role: "agent",
        parts: [{ kind: "data", data: cleanOutput }],
        taskId,
        contextId,
        metadata: { timestamp: (job.completed_at ?? job.updated_at) as string },
      });
    }
  }

  // Build artifacts for completed tasks
  const artifacts = [];
  if (state === "completed" && outputData) {
    const { _envelope, _error, ...cleanOutput } = outputData;
    if (Object.keys(cleanOutput).length > 0) {
      artifacts.push({
        artifactId: `${taskId}-output`,
        name: "Agent Response",
        parts: [{ kind: "data" as const, data: cleanOutput }],
      });
    }
  }

  return {
    kind: "task",
    id: taskId,
    contextId,
    status: {
      state,
      timestamp: (job.updated_at ?? job.created_at) as string,
    },
    history: messages,
    artifacts: artifacts.length > 0 ? artifacts : undefined,
    metadata: {
      provider_agent_id: job.provider_agent_id,
      requester_agent_id: job.requester_agent_id,
      capability_used: job.capability_used,
      cost: job.cost,
      duration_ms: job.duration_ms,
      job_type: job.job_type,
      createdAt: job.created_at,
      completedAt: job.completed_at,
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
  requesterId: string,
  providerSlug: string
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

  const capabilityUsed = (p.metadata?.capability_used as string) ?? null;
  const contextId = (p.message.contextId as string) ?? crypto.randomUUID();

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      provider_agent_id: providerAgentId,
      requester_profile_id: requesterId,
      job_type: "production",
      capability_used: capabilityUsed,
      input_summary: Object.keys(inputSummary).length ? inputSummary : null,
      status: "pending",
      cost: 0,
      verified: false,
      context_id: contextId,
    })
    .select()
    .single();

  if (error || !job) {
    return rpcError(id, A2AErrorCodes.InternalError, "Failed to create task");
  }

  // Build and store the request envelope in input_summary for auditing.
  // We merge it under a reserved "_envelope" key so it doesn't overwrite caller data.
  const requestEnvelope = wrapRequest({
    jobId: job.id as string,
    callerId: requesterId,
    providerSlug,
    capability: capabilityUsed,
    input: Object.keys(inputSummary).length ? inputSummary : null,
  });

  const enrichedInputSummary = {
    ...inputSummary,
    _envelope: requestEnvelope,
  };

  await supabase
    .from("jobs")
    .update({ input_summary: enrichedInputSummary })
    .eq("id", job.id);

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
    .update({ status: "canceled" })
    .eq("id", p.id)
    .select()
    .single();

  // Fire push notifications for cancellation
  const canceledTask = jobToTask(updated ?? job);
  dispatchPushNotifications(p.id, "canceled", canceledTask).catch(() => {});

  return success(id, canceledTask);
}

// ---------------------------------------------------------------------------
// Push Notification Config handlers
// ---------------------------------------------------------------------------

async function handlePushNotificationConfigSet(
  id: string | number,
  params: unknown,
  requesterId: string
): Promise<JSONRPCResponse<PushNotificationConfig>> {
  const p = params as PushNotificationConfigParams;
  if (!p?.taskId || !p?.pushNotificationConfig?.url) {
    return rpcError(id, A2AErrorCodes.InvalidParams, "params.taskId and params.pushNotificationConfig.url are required");
  }

  const supabase = createAdminClient();

  // Verify task exists and requester owns it
  const { data: job } = await supabase
    .from("jobs")
    .select("id, requester_profile_id")
    .eq("id", p.taskId)
    .single();

  if (!job) {
    return rpcError(id, A2AErrorCodes.TaskNotFound, `Task ${p.taskId} not found`);
  }

  if (job.requester_profile_id !== requesterId) {
    return rpcError(id, A2AErrorCodes.UnsupportedOperation, "Not authorized to configure notifications for this task");
  }

  const config = p.pushNotificationConfig;
  const { data: row, error } = await supabase
    .from("a2a_push_notification_configs")
    .upsert(
      {
        task_id: p.taskId,
        url: config.url,
        token: config.token ?? null,
        event_types: config.eventTypes ?? [],
      },
      { onConflict: "task_id,url" }
    )
    .select()
    .single();

  if (error || !row) {
    return rpcError(id, A2AErrorCodes.InternalError, "Failed to save push notification config");
  }

  return success(id, {
    id: row.id as string,
    taskId: row.task_id as string,
    url: row.url as string,
    token: row.token as string | undefined,
    eventTypes: row.event_types as string[],
  });
}

async function handlePushNotificationConfigGet(
  id: string | number,
  params: unknown
): Promise<JSONRPCResponse<PushNotificationConfig>> {
  const p = params as PushNotificationConfigQueryParams;
  if (!p?.taskId || !p?.id) {
    return rpcError(id, A2AErrorCodes.InvalidParams, "params.taskId and params.id are required");
  }

  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("a2a_push_notification_configs")
    .select("*")
    .eq("id", p.id)
    .eq("task_id", p.taskId)
    .single();

  if (!row) {
    return rpcError(id, A2AErrorCodes.TaskNotFound, "Push notification config not found");
  }

  return success(id, {
    id: row.id as string,
    taskId: row.task_id as string,
    url: row.url as string,
    token: row.token as string | undefined,
    eventTypes: row.event_types as string[],
  });
}

async function handlePushNotificationConfigList(
  id: string | number,
  params: unknown
): Promise<JSONRPCResponse<PushNotificationConfig[]>> {
  const p = params as PushNotificationConfigListParams;
  if (!p?.taskId) {
    return rpcError(id, A2AErrorCodes.InvalidParams, "params.taskId is required");
  }

  const supabase = createAdminClient();
  const { data: rows, error } = await supabase
    .from("a2a_push_notification_configs")
    .select("*")
    .eq("task_id", p.taskId)
    .order("created_at", { ascending: true });

  if (error) {
    return rpcError(id, A2AErrorCodes.InternalError, "Failed to list push notification configs");
  }

  return success(
    id,
    (rows ?? []).map((row) => ({
      id: row.id as string,
      taskId: row.task_id as string,
      url: row.url as string,
      token: row.token as string | undefined,
      eventTypes: row.event_types as string[],
    }))
  );
}

async function handlePushNotificationConfigDelete(
  id: string | number,
  params: unknown,
  requesterId: string
): Promise<JSONRPCResponse<{ deleted: boolean }>> {
  const p = params as PushNotificationConfigQueryParams;
  if (!p?.taskId || !p?.id) {
    return rpcError(id, A2AErrorCodes.InvalidParams, "params.taskId and params.id are required");
  }

  const supabase = createAdminClient();

  // Verify ownership
  const { data: job } = await supabase
    .from("jobs")
    .select("id, requester_profile_id")
    .eq("id", p.taskId)
    .single();

  if (!job) {
    return rpcError(id, A2AErrorCodes.TaskNotFound, `Task ${p.taskId} not found`);
  }

  if (job.requester_profile_id !== requesterId) {
    return rpcError(id, A2AErrorCodes.UnsupportedOperation, "Not authorized");
  }

  const { error } = await supabase
    .from("a2a_push_notification_configs")
    .delete()
    .eq("id", p.id)
    .eq("task_id", p.taskId);

  if (error) {
    return rpcError(id, A2AErrorCodes.InternalError, "Failed to delete config");
  }

  return success(id, { deleted: true });
}

// ---------------------------------------------------------------------------
// Push Notification Dispatch — fires webhooks on task state changes
// ---------------------------------------------------------------------------

export async function dispatchPushNotifications(
  taskId: string,
  state: TaskState,
  task: Task
): Promise<void> {
  const supabase = createAdminClient();

  const { data: configs } = await supabase
    .from("a2a_push_notification_configs")
    .select("*")
    .eq("task_id", taskId);

  if (!configs || configs.length === 0) return;

  const event = {
    kind: "status-update" as const,
    taskId,
    contextId: task.contextId,
    status: { state, timestamp: new Date().toISOString() },
    final: ["completed", "failed", "canceled", "rejected"].includes(state),
  };

  await Promise.allSettled(
    configs.map(async (config) => {
      // Filter by event types if specified
      const eventTypes = config.event_types as string[];
      if (eventTypes.length > 0 && !eventTypes.includes(state)) return;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (config.token) {
        headers["Authorization"] = `Bearer ${config.token}`;
      }

      try {
        await fetch(config.url as string, {
          method: "POST",
          headers,
          body: JSON.stringify(event),
        });
      } catch (err) {
        console.error(`[a2a] Push notification failed for ${config.url}:`, err);
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function dispatchA2ARpc(
  request: JSONRPCRequest,
  providerAgentId: string,
  requesterId: string,
  providerSlug?: string
): Promise<JSONRPCResponse> {
  const { id, method, params } = request;

  switch (method) {
    case "message/send":
      return handleMessageSend(id, params, providerAgentId, requesterId, providerSlug ?? providerAgentId);

    case "tasks/get":
      return handleTasksGet(id, params);

    case "tasks/cancel":
      return handleTasksCancel(id, params, requesterId);

    case "tasks/pushNotificationConfig/set":
      return handlePushNotificationConfigSet(id, params, requesterId);

    case "tasks/pushNotificationConfig/get":
      return handlePushNotificationConfigGet(id, params);

    case "tasks/pushNotificationConfig/list":
      return handlePushNotificationConfigList(id, params);

    case "tasks/pushNotificationConfig/delete":
      return handlePushNotificationConfigDelete(id, params, requesterId);

    case "agent/authenticatedExtendedCard":
      // Extended card is the same as public card for now — no private skills yet
      return rpcError(id, A2AErrorCodes.ExtendedAgentCardNotConfigured, "Extended agent card not configured");

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
    protocolVersion: "0.2.5",
    name: agent.name as string,
    description: (agent.description as string) ?? undefined,
    url: `${baseUrl}/api/agents/${agent.slug}/a2a/rpc`,
    version: "1.0",
    documentationUrl: `${baseUrl}/agents/${agent.slug}`,
    iconUrl: `${baseUrl}/agents/${agent.slug}/icon`,
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    securitySchemes: {
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "SignalPot API key",
      },
      bearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Supabase JWT token",
      },
    },
    security: [{ apiKey: [] }, { bearer: [] }],
    supportsAuthenticatedExtendedCard: false,
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
