// A2A Protocol Types
// Based on the Agent2Agent (A2A) protocol specification v0.3+
// https://a2a-protocol.org/latest/specification/

// ---------------------------------------------------------------------------
// Task States
// ---------------------------------------------------------------------------
export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "auth-required"
  | "completed"
  | "canceled"
  | "rejected"
  | "failed"
  | "unknown";

// ---------------------------------------------------------------------------
// Parts (smallest unit of content)
// ---------------------------------------------------------------------------
export interface TextPart {
  kind: "text";
  text: string;
  metadata?: Record<string, unknown>;
}

export interface FileWithBytes {
  bytes: string; // base64
  mimeType?: string;
  name?: string;
}

export interface FileWithUri {
  uri: string;
  mimeType?: string;
  name?: string;
}

export interface FilePart {
  kind: "file";
  file: FileWithBytes | FileWithUri;
  metadata?: Record<string, unknown>;
}

export interface DataPart {
  kind: "data";
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type Part = TextPart | FilePart | DataPart;

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------
export interface Message {
  kind: "message";
  role: "user" | "agent";
  parts: Part[];
  taskId?: string;
  contextId?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------
export interface Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------
export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp?: string;
}

export interface Task {
  kind: "task";
  id: string;
  contextId: string;
  status: TaskStatus;
  history?: Message[];
  artifacts?: Artifact[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Streaming Events
// ---------------------------------------------------------------------------
export interface TaskStatusUpdateEvent {
  kind: "status-update";
  taskId: string;
  contextId: string;
  status: TaskStatus;
  final: boolean;
  metadata?: Record<string, unknown>;
}

export interface TaskArtifactUpdateEvent {
  kind: "artifact-update";
  taskId: string;
  contextId: string;
  artifact: Artifact;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------
export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  inputModes?: string[];
  outputModes?: string[];
  examples?: string[];
}

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
}

export interface AgentProvider {
  organization: string;
  url?: string;
}

export interface SecurityScheme {
  type: "apiKey" | "http" | "oauth2" | "openIdConnect" | "mutualTLS";
  description?: string;
  // apiKey
  in?: "header" | "query" | "cookie";
  name?: string;
  // http
  scheme?: string;
  bearerFormat?: string;
  // oauth2 / openIdConnect
  flows?: Record<string, unknown>;
  openIdConnectUrl?: string;
}

// SignalPot verified performance extensions for agent cards.
// These fields are populated from telemetry data and trust graph,
// giving orchestrator agents machine-readable signal for provider selection.
export interface SignalPotExtensions {
  trustScore: number;               // 0-1, from trust graph
  verifiedCalls: number;            // total tracked calls (platform + external)
  successRate: number;              // 0-1, from telemetry
  avgLatencyMs: number | null;      // average response time
  eloRating: number | null;         // best arena ELO (null if no arena matches)
  arenaRecord: { wins: number; losses: number; ties: number } | null;
  costPerCall: number;              // agent rate_amount
  uptimePct: number;                // from agent stats
  lastActiveAt: string | null;      // most recent tracked activity
  profileUrl: string;               // link to full agent profile
  extractUrl: string;               // link to full extract report (owner only)
  complianceScore: number | null;   // OWASP compliance score 0-1
  complianceTestedAt: string | null;
  marketplaceListings: Array<{ provider: string; url: string; status: string }>;
}

export interface AgentCard {
  protocolVersion: string;
  name: string;
  description?: string;
  url: string; // A2A RPC endpoint URL
  version: string;
  documentationUrl?: string;
  iconUrl?: string;
  capabilities: AgentCapabilities;
  securitySchemes?: Record<string, SecurityScheme>;
  security?: Array<Record<string, string[]>>;
  supportsAuthenticatedExtendedCard?: boolean;
  skills: AgentSkill[];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  provider?: AgentProvider;
  extensions?: {
    signalpot?: SignalPotExtensions;
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 base types
// ---------------------------------------------------------------------------
export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JSONRPCSuccessResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  result: T;
}

export interface JSONRPCErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JSONRPCErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: JSONRPCErrorObject;
}

export type JSONRPCResponse<T = unknown> =
  | JSONRPCSuccessResponse<T>
  | JSONRPCErrorResponse;

// ---------------------------------------------------------------------------
// Method params
// ---------------------------------------------------------------------------
export interface MessageSendConfiguration {
  acceptedOutputModes?: string[];
  blocking?: boolean;
  historyLength?: number;
}

export interface MessageSendParams {
  message: Message;
  configuration?: MessageSendConfiguration;
  metadata?: Record<string, unknown>;
}

export interface TaskQueryParams {
  id: string;
  historyLength?: number;
  metadata?: Record<string, unknown>;
}

export interface TaskIdParams {
  id: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Push Notification Config
// ---------------------------------------------------------------------------
export interface PushNotificationConfig {
  id: string;
  taskId: string;
  url: string;
  token?: string;
  eventTypes?: string[];
}

export interface PushNotificationConfigParams {
  taskId: string;
  pushNotificationConfig: {
    url: string;
    token?: string;
    eventTypes?: string[];
  };
}

export interface PushNotificationConfigQueryParams {
  taskId: string;
  id: string;
}

export interface PushNotificationConfigListParams {
  taskId: string;
}

// ---------------------------------------------------------------------------
// A2A error codes
// ---------------------------------------------------------------------------
export const A2AErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  TaskNotFound: -32001,
  TaskNotCancelable: -32002,
  PushNotificationNotSupported: -32003,
  UnsupportedOperation: -32004,
  ContentTypeNotSupported: -32005,
  InvalidAgentResponse: -32006,
  ExtendedAgentCardNotConfigured: -32007,
  ExtensionSupportRequired: -32008,
  VersionNotSupported: -32009,
} as const;
