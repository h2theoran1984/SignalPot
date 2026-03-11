export interface AgentCapabilitySpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  examples?: { input: unknown; output: unknown }[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
  created_by: string;
  plan: "free" | "pro" | "team";
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  credit_balance_millicents: number;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  id: string;
  org_id: string;
  profile_id: string;
  role: "owner" | "admin" | "developer" | "viewer" | "auditor";
  invited_by: string | null;
  joined_at: string;
}

export interface AuditLogEntry {
  id: string;
  org_id: string | null;
  actor_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export interface Agent {
  id: string;
  owner_id: string;
  org_id?: string | null;
  name: string;
  slug: string;
  description: string | null;
  capability_schema: AgentCapabilitySpec[];
  rate_type: "per_call" | "per_task" | "per_hour";
  rate_amount: number;
  rate_currency: string;
  auth_type: "api_key" | "oauth" | "mcp_token" | "none";
  auth_config: Record<string, unknown>;
  mcp_endpoint: string | null;
  tags: string[];
  visibility: "public" | "private";
  status: "active" | "inactive" | "deprecated";
  uptime_pct: number;
  avg_latency_ms: number;
  rate_limit_rpm: number | null;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  requester_agent_id: string | null;
  provider_agent_id: string;
  requester_profile_id: string | null;
  job_type: "production" | "staging" | "test";
  capability_used: string | null;
  input_summary: Record<string, unknown> | null;
  output_summary: Record<string, unknown> | null;
  status: "pending" | "running" | "completed" | "failed";
  duration_ms: number | null;
  cost: number;
  provider_cost: number | null;
  verified: boolean;
  created_at: string;
  completed_at: string | null;
}

export interface TrustEdge {
  id: string;
  source_agent_id: string;
  target_agent_id: string;
  total_jobs: number;
  successful_jobs: number;
  production_jobs: number;
  total_spent: number;
  avg_latency_ms: number;
  last_job_at: string | null;
  trust_score: number;
}

export interface Profile {
  id: string;
  github_username: string | null;
  email: string | null;
  avatar_url: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  profile_id: string;
  org_id: string | null;
  name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit_rpm: number;
  last_used_at: string | null;
  expires_at: string | null;
  revoked: boolean;
  created_at: string;
}
