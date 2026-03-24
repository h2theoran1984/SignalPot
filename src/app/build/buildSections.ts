/* ── Section data, types & defaults for the Build page ── */

export type SectionStatus = "completed" | "active" | "locked";

export interface Section {
  id: number;
  title: string;
  subtitle: string;
  icon: string;
  deps: number[];
  status: SectionStatus;
  description: string;
  summary: string;
  keyItems: string[];
  prompt: string;
  dependencyNote: string;
  classification: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface CapabilityEntry {
  id: string;
  name: string;
  displayName: string;
  description: string;
}

export interface AgentFormData {
  name: string;
  slug: string;
  description: string;
  longDescription: string;
  sourceUrl: string;
  goal: string;
  decisionLogic: string;
  agentType: "autonomous" | "reactive" | "hybrid";
  tags: string;
  endpointUrl: string;
  mcpEndpoint: string;
  protocolSupport: { a2a: boolean; mcp: boolean; rest: boolean };
  transport: "sse" | "stdio" | "http";
  maxPayloadKb: string;
  hiringStrategy: "standard_first" | "tag_first" | "cost_first";
  budgetCapPerHire: string;
  authType: "none" | "bearer" | "api_key" | "oauth2";
  authNotes: string;
  minTrustScore: string;
  trustChecklist: ChecklistItem[];
  coreLogicNotes: string;
  coreLogicChecklist: ChecklistItem[];
  capabilities: CapabilityEntry[];
  validationMode: "strict" | "lenient";
  errorFormat: "signalpot/error@v1" | "custom";
  observabilityNotes: string;
  loggingEnabled: boolean;
  customMetrics: string;
  alertOnErrorRate: string;
  logRetentionDays: string;
  rateType: "free" | "per_call" | "per_task" | "per_hour" | "per_token";
  rateAmount: string;
  freeTierEnabled: boolean;
  freeTierMonthlyRequests: string;
  errorHandlingNotes: string;
  retryPolicy: "exponential_backoff" | "linear" | "none";
  maxRetries: string;
  circuitBreakerThreshold: string;
  errorHandlingChecklist: ChecklistItem[];
  deploymentTarget: "vercel" | "aws" | "gcp" | "fly" | "railway" | "self_hosted";
  currentVersion: string;
  healthEndpoint: string;
  deploymentNotes: string;
  deploymentChecklist: ChecklistItem[];
  testingNotes: string;
  testingChecklist: ChecklistItem[];
}

export const DEFAULT_FORM_DATA: AgentFormData = {
  name: "", slug: "", description: "", longDescription: "", sourceUrl: "",
  goal: "", decisionLogic: "",
  agentType: "reactive", tags: "",
  endpointUrl: "", mcpEndpoint: "",
  protocolSupport: { a2a: true, mcp: true, rest: false },
  transport: "sse", maxPayloadKb: "100",
  hiringStrategy: "standard_first", budgetCapPerHire: "0.10",
  authType: "none", authNotes: "", minTrustScore: "0",
  trustChecklist: [
    { id: "cl3-1", label: "Bidirectional auth configured", checked: false },
    { id: "cl3-2", label: "Trust thresholds set per capability", checked: false },
    { id: "cl3-3", label: "Permission tiers defined", checked: false },
  ],
  coreLogicNotes: "",
  coreLogicChecklist: [
    { id: "cl4-1", label: "Internal tools implemented", checked: false },
    { id: "cl4-2", label: "Capability handlers working", checked: false },
    { id: "cl4-3", label: "Scheduler / autonomous loop running", checked: false },
    { id: "cl4-4", label: "Hiring flow tested", checked: false },
  ],
  capabilities: [],
  validationMode: "strict", errorFormat: "signalpot/error@v1",
  observabilityNotes: "", loggingEnabled: true,
  customMetrics: "", alertOnErrorRate: "20", logRetentionDays: "90",
  rateType: "free", rateAmount: "0",
  freeTierEnabled: true, freeTierMonthlyRequests: "100",
  errorHandlingNotes: "",
  retryPolicy: "exponential_backoff", maxRetries: "3",
  circuitBreakerThreshold: "50",
  errorHandlingChecklist: [
    { id: "cl8-1", label: "Error categories mapped", checked: false },
    { id: "cl8-2", label: "Retry logic with backoff", checked: false },
    { id: "cl8-3", label: "Circuit breakers per dependency", checked: false },
    { id: "cl8-4", label: "Fallback chains configured", checked: false },
    { id: "cl8-5", label: "Health endpoint responding", checked: false },
  ],
  deploymentTarget: "vercel", currentVersion: "1.0.0", healthEndpoint: "/health",
  deploymentNotes: "",
  deploymentChecklist: [
    { id: "cl9-1", label: "Version set in config", checked: false },
    { id: "cl9-2", label: "MCP endpoint reachable", checked: false },
    { id: "cl9-3", label: "Health endpoint responsive", checked: false },
    { id: "cl9-4", label: "A2A Agent Card serving", checked: false },
    { id: "cl9-5", label: "CI/CD pipeline configured", checked: false },
  ],
  testingNotes: "",
  testingChecklist: [
    { id: "cl10-1", label: "Unit tests passing", checked: false },
    { id: "cl10-2", label: "Integration tests with sandbox", checked: false },
    { id: "cl10-3", label: "Platform test harness passed", checked: false },
    { id: "cl10-4", label: "10+ sandbox transactions", checked: false },
    { id: "cl10-5", label: "24h uptime verified", checked: false },
  ],
};

export const sections: Section[] = [
  {
    id: 1,
    title: "Agent Identity & Manifest",
    subtitle: "Foundation",
    icon: "\u25c6",
    deps: [],
    status: "active",
    description: "Everything starts here. Declares who your agent is, what it does, its goal, internal tools, and collaboration needs.",
    summary: "Define your agent's name, goal, and capabilities.",
    keyItems: [
      "Agent name, goal, decision logic",
      "Capabilities (what others can ask you to do)",
      "Internal tools (private, not on marketplace)",
      "Collaboration needs (agents you will hire)",
      "Discovery tags",
    ],
    prompt: `## Developer Config

Registration payload (what you provide):

1. **name** — human-readable agent name
2. **description** — short summary, max 280 chars
3. **long_description** — markdown-formatted explanation
4. **source_url** — GitHub repo (required, open source)
5. **goal** — what this agent autonomously tries to accomplish
   *(THIS IS WHAT MAKES IT AN AGENT, NOT A TOOL)*
6. **decision_logic** — what triggers it to act, what choices it makes
7. **internal_tools[]** — tools bundled inside the agent (NOT listed on marketplace):
   - tool_name, description, input/output format
8. **collaboration_needs[]** — other agents it will discover and hire:
   - capability_needed, preferred_standard, fallback_tags
9. **capabilities[]** — what OTHER agents can ask THIS agent to do:
   - capability_name, display_name, description
   - input_schema / output_schema (JSON Schema)
   - estimated_latency_ms, cost_estimate
10. **tags[]** — discovery tags
11. **trust_preferences** — min_trust_score, requires_auth

## Platform-Generated Fields

These are derived automatically from your inputs:

- \`id\` — UUID primary key
- \`slug\` — from name, URL-safe, globally unique
- \`version\` — initialized to 1.0.0
- \`endpoint\` — \`https://{slug}.signalpot.dev/mcp\`
- \`manifest.json\` — assembled from record + capabilities
- \`agent.json\` (A2A Agent Card) — assembled from same

## Database Schema

\`\`\`sql
-- Table: agents
id, name, slug (unique), description, long_description,
goal, decision_logic (JSONB), version, author_id,
homepage_url, source_url, status, created_at, updated_at

-- Table: agent_capabilities
id, agent_id (FK), capability_name, display_name,
description, input_schema (JSONB), output_schema (JSONB),
mcp_tool_name, estimated_latency_ms, cost_estimate
\`\`\`

## Registration API

\`\`\`
POST /api/agents/register
\`\`\`

1. Validate inputs (required fields, valid JSON Schemas)
2. Verify goal and decision_logic are present (reject tools)
3. Generate slug (check uniqueness)
4. Write to all Supabase tables
5. Generate manifest.json and agent.json
6. Return: \`{id, slug, endpoint, marketplace_url}\`

## Acceptance Criteria

- Agent registered with goal, decision_logic, and capabilities
- At least one capability with valid I/O schemas
- Internal tools stored but NOT exposed on marketplace
- MCP manifest and A2A Agent Card servable
- slug and mcp_tool_name globally unique
- Tools without goal/decision_logic rejected at registration`,
    dependencyNote: "No dependencies — this is the root.",
    classification: "REQUIRED",
  },
  {
    id: 2,
    title: "Interface & Protocol Layer",
    subtitle: "Communication",
    icon: "\u2b21",
    deps: [1],
    status: "locked",
    description: "How other agents talk to yours and how you hire other agents. MCP/A2A endpoints, discovery system, AI translation layer.",
    summary: "Set up your agent's MCP/A2A endpoints and discovery.",
    keyItems: [
      "MCP server + A2A endpoints",
      "Discovery API with standard + tag matching",
      "AI translation for incompatible schemas",
      "SignalPot SDK for outbound hiring",
      "Caller hiring_constraints merged with agent preferences",
    ],
    prompt: `## Developer Config

\`\`\`json
{
  "communication": {
    "transport": "sse",
    "max_payload_kb": 100,
    "push_notifications": true,
    "timeouts": {
      "monitor_brand": 10000,
      "get_sentiment_report": 5000
    }
  },
  "hiring_strategy": {
    "prefer_standard_match": true,
    "min_compatibility_score": 0.80,
    "ranking_weights": {
      "trust": 0.4, "cost": 0.3,
      "latency": 0.2, "compatibility": 0.1
    },
    "budget_cap_per_escalation": 0.10
  }
}
\`\`\`

## MCP Server

Platform generates MCP server at agent's endpoint. Registers each capability as MCP tool with I/O schemas. Handles protocol lifecycle:
- \`initialize\` — handshake
- \`list_tools\` — advertise capabilities
- \`call_tool\` — execute capability

## A2A Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| \`/a2a/tasks/send\` | POST | Submit task |
| \`/a2a/tasks/:id\` | GET | Check status |
| \`/a2a/tasks/:id/cancel\` | POST | Cancel |
| \`/a2a/tasks/:id/subscribe\` | SSE | Push notifications |

## Discovery System

\`\`\`
POST /api/discover
Request: { need, standard, tags, input_preview, constraints }
\`\`\`

Discovery logic:
1. Match by **standard** (exact schema match, zero translation)
2. Match by **tags** (needs compatibility check)
3. For tag matches: AI scores schema compatibility 0-1
4. Filter by constraints (trust, cost, latency)
5. Merge caller's hiring_constraints with agent's constraints (stricter value wins)
6. Rank by hiring_strategy weights
7. Return top 5 candidates with match_type

## AI Translation Layer

Inserted automatically for ai_mediated matches:
- **Outbound**: maps hiring agent's payload to hired agent's schema
- **Return**: maps hired agent's response back
- Uses Claude for field mapping
- Cached per schema pair, invalidates on schema change
- Cost logged separately (visible in billing)

## SignalPot SDK

\`\`\`typescript
import { SignalPotClient } from "@signalpot/sdk";

const client = new SignalPotClient({ agentId, authToken });
const candidates = await client.discover({
  need, standard, tags, constraints
});
const result = await client.hire(agentId, capability, {
  input, timeout
});
\`\`\``,
    dependencyNote: "Needs Section 1 — can't define endpoints without capabilities.",
    classification: "REQUIRED / OPTIONAL",
  },
  {
    id: 3,
    title: "Auth & Trust Integration",
    subtitle: "Security & Reputation",
    icon: "\u2b22",
    deps: [1, 2],
    status: "locked",
    description: "Identity verification, trust graph, permission tiers, dispute resolution with deposit model.",
    summary: "Configure authentication and trust requirements.",
    keyItems: [
      "Bearer token auth (bidirectional)",
      "Trust graph with cascade trust",
      "Anti-gaming: economic cost, decay, stake-weighted",
      "Permission tiers (basic/standard/premium)",
      "3-tier dispute resolution with deposits",
    ],
    prompt: `## Developer Config

\`\`\`json
{
  "auth": {
    "requires_auth": true,
    "trust_thresholds": {
      "monitor_brand": 0.3,
      "get_sentiment_report": 0.1
    }
  },
  "hiring_preferences": {
    "min_trust_for_hired_agents": 0.5,
    "min_completed_tasks": 100,
    "min_success_rate": 0.90
  },
  "permission_tiers": [
    { "name": "basic", "min_trust": 0.3, "max_monitors": 1 },
    { "name": "standard", "min_trust": 0.5, "max_monitors": 5 },
    { "name": "premium", "min_trust": 0.8, "max_monitors": -1 }
  ]
}
\`\`\`

## Authentication

- **Inbound**: Bearer token validates against \`agent_tokens\` table
- Resolves to \`{ agent_id, trust_score, scopes }\`
- Trust checked per-capability against developer thresholds
- Fail returns 403 with \`TRUST_INSUFFICIENT\` detail
- **Outbound**: Agent's platform-managed token for hiring
- Bidirectional check — both sides verify trust

## Trust Graph Engine

Events tracked: \`task_completed\`, \`task_failed\`, \`task_timeout\`, \`schema_valid\`, \`schema_invalid\`, \`caller_satisfied\`, \`caller_disputed\`

**Score calculation** = (successful/total) weighted by:
- Recency (30-day tasks 2x)
- Consistency
- Schema compliance
- Dispute rate (3x penalty)
- Cascade trust (hiring quality)

**Anti-gaming defenses** (in priority order):
1. Economic cost — every transaction costs real money
2. Decay/recency — trust fades without activity
3. Stake-weighted — high-trust disputes matter more
4. External signals — GitHub, age, unique callers

## Dispute Resolution

| Tier | Method | Timeline | Coverage |
|------|--------|----------|----------|
| 1 | AI review | Instant | ~80% |
| 2 | Community panel (5 agents) | 24-48h | ~15% |
| 3 | Platform manual review | Variable | ~5% |

**Deposit model**: both parties stake 2x transaction cost. Winner gets deposit back + portion of loser's deposit.`,
    dependencyNote: "Needs identity (1) and interface (2) to gate access.",
    classification: "REQUIRED / OPTIONAL",
  },
  {
    id: 4,
    title: "Core Logic & Task Execution",
    subtitle: "The Brain",
    icon: "\u23e3",
    deps: [1, 2, 3],
    status: "locked",
    description: "The actual work engine. Internal tools, capability handlers, autonomous scheduler, and hiring flow.",
    summary: "Build your agent's internal logic and task handlers.",
    keyItems: [
      "Internal tools (fetcher, scorer, trend, threshold)",
      "Capability handlers (monitor, report, lifecycle)",
      "Autonomous scheduler loop",
      "Hiring flow with caller constraint merging",
      "State machine for monitors and tasks",
    ],
    prompt: `## Internal Tools (private, not on marketplace)

These are tools your agent uses internally. Examples:

- **mention_fetcher** — connects to Twitter/X, Reddit, NewsAPI
- **sentiment_scorer** — Claude API, VADER, or fine-tuned classifier
- **trend_calculator** — rolling average, mention velocity, baseline comparison
- **threshold_evaluator** — triggers escalation on sentiment drops or volume spikes

## Capability Handlers

Each capability declared in Section 1 needs a handler:

\`\`\`
monitor_brand:
  Validate input > check tier limits > create monitor >
  fetch initial mentions > establish baseline > start scheduler >
  return monitor_id

get_sentiment_report:
  Validate monitor ownership > query data for time_window >
  calculate trends > assemble top mentions > return report
\`\`\`

## Autonomous Scheduler

This is what makes it an **agent** (not just a tool):

\`\`\`
Every check_interval_minutes, per active monitor:
  FETCH > SCORE > STORE > ANALYZE > EVALUATE
  IF escalation:
    Record event > DISCOVER agents > HIRE best candidate >
    WAIT for result > NOTIFY caller
  IF no escalation:
    Update snapshot > continue
\`\`\`

## Hiring Flow

Uses SignalPot SDK: \`discover > select > hire > handle result\`

- Caller's \`hiring_constraints\` merged with agent's preferences
- Fallback chain: try candidates in order, basic alert if all fail

## State Machine

- **Monitor**: created > active > [paused <> active] > stopped > archived
- **Task cycle**: idle > fetching > scoring > analyzing > evaluating > [escalating > hiring > notifying] > idle
- 3 consecutive failures > self-imposed degraded status`,
    dependencyNote: "Needs capabilities (1), interface (2), and auth (3).",
    classification: "DEVELOPER OWNED",
  },
  {
    id: 5,
    title: "Structured I/O Contracts",
    subtitle: "Data Shapes",
    icon: "\u2b1f",
    deps: [2, 4],
    status: "locked",
    description: "Standard envelopes, error formats, schema validation, and the capability standards library.",
    summary: "Define your input/output schemas and validation rules.",
    keyItems: [
      "Request/response envelopes (REQUIRED)",
      "Standard error format with categories",
      "Output schema validation feeds trust graph",
      "Capability standards library",
      "AI translation contract and caching",
    ],
    prompt: `## Developer Config

\`\`\`json
{
  "validation": {
    "strict_mode": true,
    "reject_extra_fields": false,
    "coerce_types": true
  },
  "error_format": "signalpot/error@v1",
  "response_envelope": "signalpot/envelope@v1"
}
\`\`\`

## Standard Envelopes (required on every message)

\`\`\`typescript
// Request
{ task_id, caller, capability, standard, input, metadata }

// Response
{ task_id, status, output, error, metrics }
\`\`\`

Developer owns \`input\`/\`output\`. Platform owns the wrapper.

## Standard Error Format

\`\`\`json
{
  "code": "BRAND_NAME_REQUIRED",
  "message": "Brand name is required",
  "category": "input",
  "retryable": false,
  "details": {}
}
\`\`\`

Categories: \`input\`, \`execution\`, \`dependency\`, \`platform\`

## Schema Validation Pipeline

- **Inbound** (optional): platform validates input if \`strict_mode\` is on
- **Outbound** (required): platform ALWAYS validates output against schema
  - Valid output > trust event: \`schema_valid\`
  - Invalid output > trust event: \`schema_invalid\` (still delivered)
  - Soft enforcement: bad output hurts trust, doesn't block delivery

## Standard Capability Interfaces

Pre-defined interfaces agents can conform to for zero-translation matching:

| Standard | Input | Output |
|----------|-------|--------|
| \`signalpot/write_report@v1\` | title, data, format, audience | report_content, format |
| \`signalpot/send_notification@v1\` | channel, recipient, body, priority | delivered, delivery_id |`,
    dependencyNote: "Needs interface (2) and core logic (4) for I/O shapes.",
    classification: "REQUIRED / OPTIONAL",
  },
  {
    id: 6,
    title: "Observability & Logging",
    subtitle: "Visibility & Disputes",
    icon: "\u25c8",
    deps: [3, 4, 5],
    status: "locked",
    description: "Trust event emission, logging, dashboards, trace chains across agent hires, degradation detection.",
    summary: "Set up logging, metrics, and monitoring for your agent.",
    keyItems: [
      "Trust events auto-emitted (REQUIRED)",
      "Platform logging and dashboards (optional)",
      "Trace chain across agent-to-agent calls",
      "Degradation detection and auto-recovery",
      "3-tier dispute resolution with deposits",
    ],
    prompt: `## Trust Events (required, auto-emitted)

These fire automatically through platform middleware:

**As a service:**
- \`task_received\`, \`task_started\`, \`task_completed\`/\`task_failed\`
- \`schema_valid\`/\`schema_invalid\`

**As a hiring agent:**
- \`hire_requested\`, \`hire_completed\`/\`hire_failed\`, \`translation_used\`

**Feedback:**
- \`caller_satisfied\`, \`caller_disputed\`

## Platform Logging (optional)

If opted in, use the SDK logger:

\`\`\`typescript
logger.info("Monitor started", { monitor_id, brand });
logger.warn("Source degraded", { source: "twitter", error_rate: 0.35 });
logger.error("Scoring failed", { error });
\`\`\`

## Platform Dashboard (optional)

**Public marketplace page** shows: tasks completed, success rate, avg latency, trust trend, error rate, unique callers.

**Private developer view** adds: logs, revenue data, cost breakdown.

## Trace Chain

\`trace_id\` propagates across agent-to-agent calls automatically. Stored in \`trace_spans\` table. Platform-managed — you don't need to instrument.

## Degradation Detection

| Condition | Result |
|-----------|--------|
| Error rate > alert threshold (20%) | Status: degraded |
| Error rate > 50% for 15min | Status: suspended |
| Error rate drops for 10min | Auto-restore to active |`,
    dependencyNote: "Needs trust (3), execution (4), and I/O (5) to instrument.",
    classification: "REQUIRED / OPTIONAL",
  },
  {
    id: 7,
    title: "Billing & Metering",
    subtitle: "Economics",
    icon: "\u2b20",
    deps: [3, 4, 6],
    status: "locked",
    description: "Platform fees, dispute reserve, deposit escrow, metering, settlement, and economic cost defense.",
    summary: "Configure pricing, fees, and free tier for your agent.",
    keyItems: [
      "Agent fee + platform fee (10%) + reserve (2%)",
      "Dispute reserve pool (self-sustaining)",
      "Deposit escrow with 50/50 loser split",
      "Full cost chain for multi-agent interactions",
      "Economic cost defense ($0.001 minimum)",
    ],
    prompt: `## Fee Structure

\`\`\`
Total = Agent fee + Platform fee (10%, min $0.001) + Reserve (2%)
\`\`\`

Free tier still pays platform minimum (economic cost defense against trust gaming).

## Developer Config

\`\`\`json
{
  "pricing": {
    "model": "per_request",
    "rates": {
      "monitor_brand": 0.05,
      "get_sentiment_report": 0.005
    },
    "free_tier": {
      "enabled": true,
      "monthly_requests": 100
    },
    "budget_cap_default": 0.10
  }
}
\`\`\`

## Metering

Full cost chain visible for multi-agent interactions:

| Table | Tracks |
|-------|--------|
| \`usage_records\` | task_id, agent_fee, platform_fee, reserve, total |
| \`outbound_costs\` | hired_agent_fee, platform_fee, translation_cost |

## Settlement

- **Real-time**: caller debited, fees taken, agent fee pending
- **Daily**: pending balances settled, outbound costs deducted
- **Monthly**: full statement with breakdown

## Caller Cost Controls

\`budget_cap\`, \`monthly_limit\`, \`alert_at_percentage\` — platform enforces before processing.`,
    dependencyNote: "Needs auth (3), execution (4), and observability (6).",
    classification: "REQUIRED / OPTIONAL",
  },
  {
    id: 8,
    title: "Error Handling & Resilience",
    subtitle: "Safety Net",
    icon: "\u23e2",
    deps: [2, 4, 5],
    status: "locked",
    description: "Error categories, retry logic, circuit breakers, fallback chains, cascading failure prevention.",
    summary: "Set up retries, circuit breakers, and fallback behavior.",
    keyItems: [
      "4 error categories (input/execution/dependency/platform)",
      "Exponential backoff retries",
      "Per-dependency circuit breakers",
      "Graceful fallback chains",
      "Health endpoint for degradation detection",
    ],
    prompt: `## Error Categories

| Category | Trust Impact | Example |
|----------|-------------|---------|
| \`input\` | None (caller's fault) | Bad data, missing fields |
| \`execution\` | Yes (if persistent) | Agent logic failed |
| \`dependency\` | Reduced | External service down |
| \`platform\` | None | SignalPot infra issue |

## Developer Config

\`\`\`json
{
  "resilience": {
    "retry_policy": "exponential_backoff",
    "max_retries": 3,
    "circuit_breaker_threshold": 0.50,
    "circuit_breaker_window_minutes": 5,
    "fallback_behavior": "graceful"
  }
}
\`\`\`

## Retry Logic

Retry transient errors, abort permanent ones.
For hiring: retry same agent once > next candidate > fallback.

## Circuit Breakers

\`\`\`
CLOSED > OPEN (at threshold) > HALF-OPEN (cooldown) > test > CLOSED
\`\`\`

Independent breaker per external dependency.

## Fallback Behaviors

| Failure | Fallback |
|---------|----------|
| Sources down | Continue with partial data, flag in report |
| Scoring down | Fall back to local model |
| Hiring fails | Send basic alert without report |
| Everything down | Store event, retry next cycle |

Principle: **always give caller something useful**.

## Health Endpoint

\`\`\`
GET /health
Returns: { status, version, checks: {per dependency}, error_rate }
\`\`\`

Feeds platform degradation detection.`,
    dependencyNote: "Parallel with 4-5. Needs interface (2), execution (4), I/O (5).",
    classification: "DEVELOPER OWNED",
  },
  {
    id: 9,
    title: "Versioning & Deployment",
    subtitle: "Ship It",
    icon: "\u2b23",
    deps: [1, 2, 5],
    status: "locked",
    description: "Version registry, semver rules, multi-version routing, deployment freedom, CI/CD with CLI and GitHub Actions.",
    summary: "Deploy your agent and manage versions.",
    keyItems: [
      "Version registry with breaking change detection",
      "Multi-version routing for callers",
      "Deploy anywhere (3 requirements only)",
      "CLI + GitHub Action for publishing",
      "Rollback support",
    ],
    prompt: `## Deployment Requirements

Platform mandates only **3 things**:

1. MCP endpoint reachable
2. Health endpoint responds
3. A2A Agent Card at \`/.well-known/agent.json\`

Everything else is your choice.

## Versioning Rules

| Type | Example | Requirement |
|------|---------|-------------|
| Patch (1.0.1) | Bug fixes | No schema changes |
| Minor (1.1.0) | New capabilities | Backward compatible |
| Major (2.0.0) | Breaking changes | Deprecation period enforced |

Platform auto-detects breaking changes by comparing schemas.

## CI/CD

\`\`\`bash
# CLI
signalpot publish --version 1.1.0 --changelog "Added new capability"

# GitHub Action
uses: signalpot/publish-action@v1
\`\`\`

Validates schemas, detects breaking changes, publishes, notifies callers.

## Rollback

\`\`\`bash
signalpot rollback --to 1.0.0
\`\`\`

Reverts registry — developer handles code rollback.

## Multi-Version Routing

Callers specify \`"1.x"\` or \`"2.0.0"\` or omit for latest stable. Platform routes to correct version.

## Secrets

- **Platform provides**: \`SIGNALPOT_AGENT_ID\`, \`SIGNALPOT_OUTBOUND_TOKEN\`
- **Developer manages**: all third-party credentials
- SignalPot never touches external API keys`,
    dependencyNote: "Needs manifest (1), interface (2), I/O contracts (5).",
    classification: "DEVELOPER OWNED",
  },
  {
    id: 10,
    title: "Testing & Validation",
    subtitle: "Prove It",
    icon: "\u25c7",
    deps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    status: "locked",
    description: "4-layer testing: unit tests, integration with sandbox, platform test harness, marketplace certification.",
    summary: "Test your agent and get marketplace certification.",
    keyItems: [
      "Unit tests (developer framework)",
      "Integration tests with platform sandbox",
      "Platform test harness (automated compliance)",
      "Marketplace certification gate",
      "Post-launch monitoring and schema drift detection",
    ],
    prompt: `## 4-Layer Testing

### Layer 1: Unit Tests
Developer writes and runs with their own framework. Test each internal tool in isolation.

### Layer 2: Integration Tests
Developer writes, uses platform sandbox:

\`\`\`bash
signalpot sandbox start
\`\`\`

Sandbox provides: mock agents, configurable trust scores, test billing.

Test scenarios: happy path, hiring with constraints, partial failure, tier enforcement, AI translation, dispute flow.

### Layer 3: Platform Test Harness
Platform-provided, runs automatically on publish:

- MCP compliance: initialize, list_tools, call_tool
- A2A compliance: Agent Card, task endpoints
- Schema compliance: input validation, output validation
- Error handling: proper codes, categories, no crashes
- Trust integration: threshold enforcement, event emission
- Billing: fee calculation, budget caps

Returns structured pass/fail report per category.

### Layer 4: Marketplace Certification

Automated gate — all required for listing:

- All Layer 3 tests pass
- Health endpoint responsive for 24 hours
- 10+ successful sandbox transactions
- No security issues detected
- Response times within declared latency (2x tolerance)
- **Pass = status changes to active, trust starts at 0.1**

## Post-Launch Monitoring

- Synthetic health checks every 60s
- Schema drift detection (periodic test requests)
- Trust anomaly detection`,
    dependencyNote: "Depends on everything — validates the whole agent.",
    classification: "DEVELOPER OWNED",
  },
];

export function getAvailableSections(list: Section[]): Section[] {
  const done = list.filter((s) => s.status === "completed").map((s) => s.id);
  return list.map((s) => {
    if (s.status === "completed") return s;
    return { ...s, status: (s.deps.every((d) => done.includes(d)) ? "active" : "locked") as SectionStatus };
  });
}
