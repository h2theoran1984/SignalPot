// TypeScript interfaces for the hardened dispute resolution system.
// Used by The Arbiter (T1/T3) and the panel engine (T2).

/**
 * Evidence bundle passed to The Arbiter or panel agents.
 */
export interface DisputeEvidence {
  dispute_id: string;
  job_id: string;
  dispute_reason: string;
  agent_name: string;
  capability: string | null;
  rate_amount: number | null;
  input_envelope: Record<string, unknown> | null;
  output_envelope: Record<string, unknown> | null;
  capability_schema: Record<string, unknown> | null;
  output_schema: Record<string, unknown> | null;
  schema_valid: boolean | string;
  /** T1/T2 decisions included when calling The Arbiter at T3 */
  prior_decisions?: PriorDecision[];
}

/**
 * A prior decision from an earlier tier, provided as context to higher tiers.
 */
export interface PriorDecision {
  tier: 1 | 2;
  decision: "upheld" | "rejected" | "partial" | "escalated";
  confidence?: number;
  reasoning: string;
  /** T2 only: vote breakdown */
  votes?: { upheld: number; rejected: number; total: number };
}

/**
 * Response from The Arbiter agent (or Claude fallback).
 */
export interface ArbiterResponse {
  decision: "upheld" | "rejected" | "partial";
  confidence: number;
  reasoning: string;
  /** Whether this came from the real Arbiter MCP call or the Claude fallback */
  source: "arbiter" | "fallback";
}

/**
 * Response from a panel agent vote (T2 hardening).
 */
export interface PanelVote {
  vote: "upheld" | "rejected";
  reasoning: string;
  agent_id: string;
  agent_name: string;
  /** Whether this came from a real MCP call or the Claude fallback */
  source: "mcp" | "fallback";
}

/**
 * MCP request payload sent to The Arbiter agent.
 */
export interface ArbiterMCPRequest {
  capability: string;
  input: {
    dispute_reason: string;
    agent_name: string;
    capability: string | null;
    input_envelope: Record<string, unknown> | null;
    output_envelope: Record<string, unknown> | null;
    capability_schema: Record<string, unknown> | null;
    output_schema: Record<string, unknown> | null;
    schema_valid: boolean | string;
    rate_amount: number | null;
    tier: 1 | 3;
    prior_decisions?: PriorDecision[];
  };
  job_id: string;
  _envelope: Record<string, unknown>;
}

/**
 * MCP request payload sent to panel agents for T2 voting.
 */
export interface PanelVoteMCPRequest {
  capability: string;
  input: {
    dispute_reason: string;
    input_envelope: Record<string, unknown> | null;
    output_envelope: Record<string, unknown> | null;
    schema_valid: boolean | string;
  };
  job_id: string;
  _envelope: Record<string, unknown>;
}
