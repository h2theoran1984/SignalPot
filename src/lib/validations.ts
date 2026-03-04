import { z } from "zod";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

const capabilitySpecSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000),
  inputSchema: z.record(z.string(), z.unknown()).optional().default({}),
  outputSchema: z.record(z.string(), z.unknown()).optional().default({}),
  examples: z
    .array(z.object({ input: z.unknown(), output: z.unknown() }))
    .max(20)
    .optional(),
});

// Grace period: goal and decision_logic are optional now but will be required after enforcement date.
// Registration API logs a warning when these are missing.
export const AGENT_IDENTITY_ENFORCE_DATE = new Date("2026-05-01");
export function agentIdentityRequired(): boolean {
  return new Date() >= AGENT_IDENTITY_ENFORCE_DATE;
}

export const createAgentSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(SLUG_REGEX, "Slug must be lowercase alphanumeric with hyphens"),
  description: z.string().max(2000).nullable().optional(),
  // Agent identity fields (required after AGENT_IDENTITY_ENFORCE_DATE)
  goal: z.string().min(10).max(500).nullable().optional(),
  decision_logic: z.string().min(20).max(2000).nullable().optional(),
  agent_type: z.enum(["autonomous", "reactive", "hybrid"]).optional().default("autonomous"),
  capability_schema: z.array(capabilitySpecSchema).max(50).optional().default([]),
  rate_type: z.enum(["per_call", "per_task", "per_hour"]).optional().default("per_call"),
  rate_amount: z.number().min(0.001, "Minimum rate is $0.001 per call").max(1_000_000).optional().default(0),
  rate_currency: z.string().max(10).optional().default("USD"),
  auth_type: z.enum(["api_key", "oauth", "mcp_token", "none"]).optional().default("none"),
  auth_config: z.record(z.string(), z.unknown()).optional().default({}),
  mcp_endpoint: z
    .string()
    .url()
    .refine((url) => url.startsWith("https://"), { message: "MCP endpoint must use HTTPS" })
    .nullable()
    .optional(),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(SLUG_REGEX, "Slug must be lowercase alphanumeric with hyphens")
    .optional(),
  description: z.string().max(2000).nullable().optional(),
  goal: z.string().min(10).max(500).nullable().optional(),
  decision_logic: z.string().min(20).max(2000).nullable().optional(),
  agent_type: z.enum(["autonomous", "reactive", "hybrid"]).optional(),
  capability_schema: z.array(capabilitySpecSchema).max(50).optional(),
  rate_type: z.enum(["per_call", "per_task", "per_hour"]).optional(),
  rate_amount: z.number().min(0.001, "Minimum rate is $0.001 per call").max(1_000_000).optional(),
  rate_currency: z.string().max(10).optional(),
  auth_type: z.enum(["api_key", "oauth", "mcp_token", "none"]).optional(),
  auth_config: z.record(z.string(), z.unknown()).optional(),
  mcp_endpoint: z
    .string()
    .url()
    .refine((url) => url.startsWith("https://"), { message: "MCP endpoint must use HTTPS" })
    .nullable()
    .optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export const callerConstraintsSchema = z.object({
  min_trust: z.number().min(0).max(1).optional(),
  required_tags: z.array(z.string()).optional(),
  blocked_agents: z.array(z.string()).optional(), // agent slugs
  max_cost: z.number().min(0).optional(),
}).optional();

export function mergeConstraints(
  callerConstraints?: z.infer<typeof callerConstraintsSchema>,
  agentConstraints?: z.infer<typeof callerConstraintsSchema>
): z.infer<typeof callerConstraintsSchema> {
  if (!callerConstraints && !agentConstraints) return undefined;
  const c = callerConstraints ?? {};
  const a = agentConstraints ?? {};
  return {
    // Stricter = higher min_trust
    min_trust: Math.max(c.min_trust ?? 0, a.min_trust ?? 0) || undefined,
    // Union of required tags
    required_tags: [...new Set([...(c.required_tags ?? []), ...(a.required_tags ?? [])])],
    // Union of blocked agents
    blocked_agents: [...new Set([...(c.blocked_agents ?? []), ...(a.blocked_agents ?? [])])],
    // Stricter = lower max_cost
    max_cost:
      c.max_cost !== undefined && a.max_cost !== undefined
        ? Math.min(c.max_cost, a.max_cost)
        : (c.max_cost ?? a.max_cost),
  };
}

export const createJobSchema = z.object({
  requester_agent_id: z.string().uuid().nullable().optional(),
  provider_agent_id: z.string().uuid(),
  job_type: z.enum(["production", "staging", "test"]).optional().default("production"),
  capability_used: z.string().max(200).nullable().optional(),
  input_summary: z.record(z.string(), z.unknown()).nullable().optional(),
  output_summary: z.record(z.string(), z.unknown()).nullable().optional(),
  duration_ms: z.number().int().min(0).max(86_400_000).nullable().optional(),
  cost: z.number().min(0).max(1_000_000).optional().default(0),
  caller_constraints: callerConstraintsSchema,
});

export const updateDisputeSchema = z.object({
  status: z.enum(["open", "reviewing", "resolved", "appealed"]),
  resolution: z.enum(["upheld", "rejected", "partial"]).optional(),
  resolver_notes: z.string().max(2000).optional(),
  tier: z.number().int().min(1).max(3).optional(),
});

export const updateJobSchema = z.object({
  status: z.enum(["running", "completed", "failed"]).optional(),
  output_summary: z.record(z.string(), z.unknown()).nullable().optional(),
  duration_ms: z.number().int().min(0).max(86_400_000).nullable().optional(),
  cost: z.number().min(0).max(1_000_000).optional(),
});

const VALID_SCOPES = [
  "agents:read", "agents:write",
  "jobs:read", "jobs:write",
  "trust:read",
] as const;

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100).trim().optional().default("Default"),
  scopes: z
    .array(z.enum(VALID_SCOPES))
    .min(1)
    .max(VALID_SCOPES.length)
    .optional()
    .default([...VALID_SCOPES]),
  rate_limit_rpm: z.number().int().min(1).max(1000).optional().default(60),
});

export const proxyCallSchema = z.object({
  capability: z.string().min(1).max(200),
  input: z.record(z.string(), z.unknown()).refine(
    (val) => JSON.stringify(val).length <= 10_240,
    { message: "Input payload must be 10KB or less" }
  ),
  session_token: z.string().uuid().optional(),
  idempotency_key: z.string().min(8).max(128),
});

export const anonTopupSchema = z.object({
  amount_usd: z.number().min(1).max(5),
});

// Escape ILIKE special characters
export function escapeIlike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

// Validate redirect path (prevent open redirects)
export function safeRedirectPath(path: string): string {
  // Must start with / and not start with // (protocol-relative)
  if (!path.startsWith("/") || path.startsWith("//")) {
    return "/dashboard";
  }
  // Block backslash tricks
  if (path.includes("\\")) {
    return "/dashboard";
  }
  // Ensure the path doesn't contain protocol
  try {
    const url = new URL(path, "http://localhost");
    if (url.hostname !== "localhost") {
      return "/dashboard";
    }
  } catch {
    return "/dashboard";
  }
  return path;
}

// Strip sensitive fields from agent data for non-owners
export function stripSensitiveAgentFields(
  agent: Record<string, unknown>,
  userId?: string
): Record<string, unknown> {
  if (agent.owner_id === userId) return agent;
  const { auth_config: _, ...safe } = agent;
  return safe;
}
