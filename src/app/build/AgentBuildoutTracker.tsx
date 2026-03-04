"use client";

import { useState } from "react";

const sections = [
  {
    id: 1, title: "Agent Identity & Manifest", subtitle: "Foundation",
    icon: "\u25c6", deps: [], status: "active" as const,
    description: "Everything starts here. Declares who your agent is, what it does, its goal, internal tools, and collaboration needs. Rejects tools without autonomous goals.",
    keyItems: ["Agent name, goal, decision logic", "Capabilities (what others can ask you to do)", "Internal tools (private, not on marketplace)", "Collaboration needs (agents you will hire)", "Discovery tags"],
    prompt: "SECTION 1: AGENT IDENTITY & MANIFEST\nClassification: REQUIRED\n\n== DEVELOPER CONFIG ==\n\nRegistration payload (what the developer provides):\n\n1. name \u2014 human-readable agent name\n2. description \u2014 short summary, max 280 chars\n3. long_description \u2014 markdown-formatted explanation\n4. source_url \u2014 GitHub repo (required, open source)\n5. goal \u2014 what this agent autonomously tries to accomplish\n   (THIS IS WHAT MAKES IT AN AGENT, NOT A TOOL)\n6. decision_logic \u2014 what triggers it to act, what choices it makes\n7. internal_tools[] \u2014 tools bundled inside the agent (NOT listed on marketplace):\n   a. tool_name\n   b. description\n   c. input/output format\n8. collaboration_needs[] \u2014 other agents it will discover and hire:\n   a. capability_needed\n   b. preferred_standard (e.g. signalpot/write_report@v1)\n   c. fallback_tags\n9. capabilities[] \u2014 what OTHER agents can ask THIS agent to do:\n   a. capability_name \u2014 machine-readable ID\n   b. display_name \u2014 human-readable label\n   c. description\n   d. input_schema \u2014 JSON Schema\n   e. output_schema \u2014 JSON Schema\n   f. estimated_latency_ms\n   g. cost_estimate\n10. tags[] \u2014 discovery tags\n11. trust_preferences:\n    a. min_trust_score (0 = open)\n    b. requires_auth\n\n== PLATFORM-GENERATED (derived from inputs) ==\n\n1. id \u2014 UUID primary key\n2. slug \u2014 from name, URL-safe, globally unique\n3. version \u2014 initialized to 1.0.0\n4. author_id \u2014 from authenticated session\n5. created_at / updated_at\n6. status \u2014 draft > active > deprecated > suspended\n7. homepage_url \u2014 defaults to marketplace page\n8. mcp_tool_name \u2014 from slug + capability_name\n9. tag_type \u2014 inferred per tag\n10. endpoint \u2014 https://{slug}.signalpot.dev/mcp\n11. manifest.json \u2014 assembled from record + capabilities\n12. agent.json (A2A Agent Card) \u2014 assembled from same\n13. marketplace_url \u2014 https://signalpot.dev/agents/{slug}\n\n== DATABASE SCHEMA (Supabase) ==\n\nTable: agents\n  id, name, slug (unique), description, long_description,\n  goal, decision_logic (JSONB), version, author_id,\n  homepage_url, source_url, status, created_at, updated_at\n\nTable: agent_capabilities\n  id, agent_id (FK), capability_name, display_name,\n  description, input_schema (JSONB), output_schema (JSONB),\n  mcp_tool_name, estimated_latency_ms, cost_estimate\n\nTable: agent_internal_tools\n  id, agent_id (FK), tool_name, description,\n  input_format (JSONB), output_format (JSONB)\n\nTable: agent_collaboration_needs\n  id, agent_id (FK), capability_needed, preferred_standard,\n  fallback_tags (JSONB)\n\nTable: agent_tags\n  agent_id (FK), tag, tag_type (enum)\n\n== REGISTRATION API ==\n\nPOST /api/agents/register\n1. Validate inputs (required fields, valid JSON Schemas)\n2. Verify goal and decision_logic are present (reject tools)\n3. Generate slug (check uniqueness)\n4. Write to all Supabase tables\n5. Generate manifest.json and agent.json\n6. Return: {id, slug, endpoint, marketplace_url}\n\n== ACCEPTANCE CRITERIA ==\n\n- Agent registered with goal, decision_logic, and capabilities\n- At least one capability with valid I/O schemas\n- Internal tools stored but NOT exposed on marketplace\n- Collaboration needs declared for discovery\n- MCP manifest and A2A Agent Card servable\n- Agent discoverable by tags\n- slug and mcp_tool_name globally unique\n- Tools without goal/decision_logic rejected at registration",
    dependencyNote: "No dependencies - this is the root.",
    classification: "REQUIRED"
  },
  {
    id: 2, title: "Interface & Protocol Layer", subtitle: "Communication",
    icon: "\u2b21", deps: [1], status: "locked" as const,
    description: "How other agents talk to yours and how you hire other agents. MCP/A2A endpoints, discovery system, AI translation layer.",
    keyItems: ["MCP server + A2A endpoints", "Discovery API with standard + tag matching", "AI translation for incompatible schemas", "SignalPot SDK for outbound hiring", "Caller hiring_constraints merged with agent preferences"],
    prompt: "SECTION 2: INTERFACE & PROTOCOL LAYER\nClassification: REQUIRED for MCP/A2A, OPTIONAL for platform hosting\n\n== DEVELOPER CONFIG ==\n\n{\n  \"communication\": {\n    \"transport\": \"sse\",\n    \"max_payload_kb\": 100,\n    \"concurrency\": { \"monitor_brand\": 10, \"get_sentiment_report\": 50 },\n    \"push_notifications\": true,\n    \"timeouts\": {\n      \"monitor_brand\": 10000,\n      \"get_sentiment_report\": 5000,\n      \"lifecycle_controls\": 3000\n    }\n  },\n  \"hiring_strategy\": {\n    \"prefer_standard_match\": true,\n    \"min_compatibility_score\": 0.80,\n    \"ranking_weights\": { \"trust\": 0.4, \"cost\": 0.3, \"latency\": 0.2, \"compatibility\": 0.1 },\n    \"outbound_timeout\": 60000,\n    \"outbound_retries\": 2,\n    \"budget_cap_per_escalation\": 0.10\n  }\n}\n\n== PLATFORM SPEC ==\n\n2.1 \u2014 MCP Server\n  Platform generates MCP server at agent's endpoint\n  Registers each capability as MCP tool with I/O schemas\n  Handles protocol lifecycle (initialize, list tools, call tool)\n  Routes tool calls to capability handlers\n\n2.2 \u2014 A2A Endpoints\n  POST /a2a/tasks/send \u2014 submit task\n  GET /a2a/tasks/:id \u2014 check status\n  POST /a2a/tasks/:id/cancel \u2014 cancel\n  SSE /a2a/tasks/:id/subscribe \u2014 push notifications\n\n2.3 \u2014 Discovery System\n  Standard Capability Interfaces stored in capability_standards table\n  Agents declare conformity to standards at registration\n\n  POST /api/discover\n  Request: { need, standard, tags, input_preview, constraints }\n  \n  Discovery logic:\n  1. Match by standard (exact schema match, zero translation)\n  2. Match by tags (needs compatibility check)\n  3. For tag matches: AI scores schema compatibility 0-1\n  4. Filter by constraints (trust, cost, latency)\n  5. Merge caller's hiring_constraints with agent's constraints\n     (stricter value wins for each parameter)\n  6. Rank by hiring_strategy weights\n  7. Return top 5 candidates with match_type (standard/ai_mediated)\n\n2.4 \u2014 AI Translation Layer\n  Inserted automatically for ai_mediated matches\n  Outbound: maps hiring agent's payload to hired agent's schema\n  Return: maps hired agent's response back\n  Uses Claude for field mapping\n  Cached per schema pair, invalidates on schema change\n  Cost logged separately (visible in billing)\n\n  Table: translation_events\n    id, hiring_agent_id, hired_agent_id, task_id, direction,\n    source_schema_hash, target_schema_hash, confidence,\n    field_mappings (JSONB), latency_ms, cost, success, created_at\n\n2.5 \u2014 SignalPot SDK (for outbound hiring)\n  import { SignalPotClient } from \"@signalpot/sdk\";\n  const client = new SignalPotClient({ agentId, authToken });\n  const candidates = await client.discover({ need, standard, tags, constraints });\n  const result = await client.hire(agentId, capability, { input, timeout });\n\n2.6 \u2014 Acceptance Criteria\n  - MCP server handles initialize, list_tools, call_tool\n  - A2A endpoints handle full task lifecycle\n  - Push notifications delivered via SSE\n  - Discovery returns ranked candidates with match_type\n  - Standard matches route with zero translation\n  - AI-mediated matches translate both directions\n  - Caller hiring_constraints merge with agent constraints\n  - Translation cached and cost tracked\n  - Budget cap enforced on outbound hires",
    dependencyNote: "Needs Section 1 - can't define endpoints without capabilities.",
    classification: "REQUIRED / OPTIONAL"
  },
  {
    id: 3, title: "Auth & Trust Integration", subtitle: "Security & Reputation",
    icon: "\u2b22", deps: [1, 2], status: "locked" as const,
    description: "Identity verification, trust graph, permission tiers, dispute resolution with deposit model. The immune system of SignalPot.",
    keyItems: ["Bearer token auth (bidirectional)", "Trust graph with cascade trust", "Anti-gaming: economic cost, decay, stake-weighted", "Permission tiers (basic/standard/premium)", "3-tier dispute resolution with deposits"],
    prompt: "SECTION 3: AUTH & TRUST INTEGRATION\nClassification: REQUIRED for identity and trust, OPTIONAL for token mgmt and tiers\n\n== DEVELOPER CONFIG ==\n\n{\n  \"auth\": {\n    \"requires_auth\": true,\n    \"trust_thresholds\": {\n      \"monitor_brand\": 0.3,\n      \"get_sentiment_report\": 0.1,\n      \"pause_resume_stop\": 0.3\n    }\n  },\n  \"hiring_preferences\": {\n    \"min_trust_for_hired_agents\": 0.5,\n    \"min_completed_tasks\": 100,\n    \"min_success_rate\": 0.90\n  },\n  \"permission_tiers\": [\n    { \"name\": \"basic\", \"min_trust\": 0.3, \"max_monitors\": 1, \"min_interval\": 15 },\n    { \"name\": \"standard\", \"min_trust\": 0.5, \"max_monitors\": 5, \"min_interval\": 5 },\n    { \"name\": \"premium\", \"min_trust\": 0.8, \"max_monitors\": -1, \"min_interval\": 1 }\n  ]\n}\n\n== PLATFORM SPEC ==\n\n3.1 \u2014 Authentication\n  Inbound: Bearer token validates against agent_tokens table\n  Resolves to { agent_id, trust_score, scopes }\n  Trust checked per-capability against developer thresholds\n  Fail returns 403 with TRUST_INSUFFICIENT detail\n\n  Outbound: Agent's platform-managed token for hiring\n  Bidirectional check \u2014 both sides verify trust\n  Credential isolation \u2014 hired agents never see original caller\n\n3.2 \u2014 Trust Graph Engine\n  Table: trust_events\n    actor_agent_id, caller_agent_id, task_id, event_type, created_at\n  \n  Events: task_completed, task_failed, task_timeout,\n    schema_valid, schema_invalid, caller_satisfied,\n    caller_disputed, translation_success, translation_failure\n\n  Score = (successful/total) weighted by:\n    Recency (30-day tasks 2x), Consistency, Schema compliance,\n    Dispute rate (3x penalty), Cascade trust (hiring quality)\n\n  Anti-gaming defenses (ship in priority order):\n  1. Economic cost \u2014 every transaction costs real money\n  2. Decay/recency \u2014 trust fades without activity\n  3. Stake-weighted \u2014 high-trust disputes matter more\n  4. External signals \u2014 GitHub, age, unique callers\n  5. Graph analysis \u2014 detect fake clusters (v2/v3)\n\n3.3 \u2014 Trust Events (auto-emitted by platform middleware)\n  As service: task outcomes + schema checks\n  As hiring agent: caller satisfaction + schema + timeout events\n  Cascade: good hiring decisions boost agent's own score\n\n3.4 \u2014 Permission Tier Enforcement\n  Resolve caller trust > match to tier > inject limits into context\n\n3.5 \u2014 Dispute Resolution\n  Tier 1: AI reviews input/output/schema/reason (instant, ~80%)\n    Confidence >= 0.85 auto-resolves\n  Tier 2: Community panel of 5 high-trust agents (24-48h, ~15%)\n    Anonymous, no conflicts of interest, majority vote\n  Tier 3: Platform manual review (final, ~5%)\n\n  Deposit model: both parties stake 2x transaction cost\n  Winner: deposit back + portion of loser's deposit\n  Platform: keeps portion of loser's deposit (funds reserve)\n\n3.6 \u2014 Security Boundaries (all platform-enforced)\n  No credential forwarding\n  Row-level data isolation (Supabase RLS)\n  Budget enforcement on outbound hires\n  Per-caller rate limiting by tier\n  Full audit trail\n\n3.7 \u2014 Token Management (all platform-managed)\n  Inbound: scoped per capability, 90-day expiry, revocable\n  Outbound: encrypted env var, 30-day rotation\n  Platform: internal ops, never exposed",
    dependencyNote: "Needs identity (1) and interface (2) to gate access.",
    classification: "REQUIRED / OPTIONAL"
  },
  {
    id: 4, title: "Core Logic & Task Execution", subtitle: "The Brain",
    icon: "\u23e3", deps: [1, 2, 3], status: "locked" as const,
    description: "The actual work engine. Internal tools, capability handlers, autonomous scheduler, and hiring flow. 100% developer-owned.",
    keyItems: ["Internal tools (fetcher, scorer, trend, threshold)", "Capability handlers (monitor, report, lifecycle)", "Autonomous scheduler loop", "Hiring flow with caller constraint merging", "State machine for monitors and tasks"],
    prompt: "SECTION 4: CORE LOGIC & TASK EXECUTION\nClassification: DEVELOPER OWNED\n\nSignalPot provides the entry point (MCP tool call) and exit point\n(structured response). Everything in between is developer code.\n\n== INTERNAL TOOLS (private, not on marketplace) ==\n\nmention_fetcher:\n  Connects to Twitter/X, Reddit, NewsAPI, Google Alerts\n  Developer manages their own API keys\n  Normalizes to common format: { text, source, author, url, timestamp }\n\nsentiment_scorer:\n  Option A: Claude API (~$0.001/mention, most nuanced)\n  Option B: VADER/TextBlob (free, less accurate)\n  Option C: Fine-tuned classifier (best accuracy, most effort)\n  Returns: { sentiment, confidence, scores: {pos, neg, neu} }\n\ntrend_calculator:\n  Rolling average, mention velocity, baseline comparison\n  Baseline from first 7 days of monitoring\n  Returns: { avg_sentiment, baseline, delta, velocity, trend }\n\nthreshold_evaluator:\n  IF delta% < sentiment_threshold \u2192 ESCALATE (sentiment_drop)\n  IF velocity > baseline * multiplier \u2192 ESCALATE (volume_spike)\n  IF both \u2192 ESCALATE (critical)\n\n== CAPABILITY HANDLERS ==\n\nmonitor_brand:\n  Validate input > check tier limits > create monitor >\n  fetch initial mentions > establish baseline > start scheduler >\n  return monitor_id\n\nget_sentiment_report:\n  Validate monitor ownership > query data for time_window >\n  calculate trends > assemble top mentions > return report\n\npause/resume/stop:\n  Validate ownership > update status > manage scheduler\n\n== SCHEDULER (the autonomous part) ==\n\nEvery check_interval_minutes, per active monitor:\n  FETCH > SCORE > STORE > ANALYZE > EVALUATE\n  IF escalation:\n    Record event > DISCOVER agents (with merged caller constraints) >\n    HIRE best candidate > WAIT for result > NOTIFY caller\n  IF no escalation:\n    Update snapshot > continue\n\n== HIRING FLOW ==\n\nUses SignalPot SDK: discover > select > hire > handle result\nCaller's hiring_constraints merged with agent's preferences\nFallback chain: try candidates in order > basic alert if all fail\n\n== STATE MACHINE ==\n\nMonitor: created > active > [paused <> active] > stopped > archived\nTask cycle: idle > fetching > scoring > analyzing > evaluating >\n  [escalating > hiring > notifying] > idle\n3 consecutive failures > self-imposed degraded status",
    dependencyNote: "Needs capabilities (1), interface (2), and auth (3).",
    classification: "DEVELOPER OWNED"
  },
  {
    id: 5, title: "Structured I/O Contracts", subtitle: "Data Shapes",
    icon: "\u2b1f", deps: [2, 4], status: "locked" as const,
    description: "Standard envelopes, error formats, schema validation, and the capability standards library. Platform owns the wrapper, developer owns the payload.",
    keyItems: ["Request/response envelopes (REQUIRED)", "Standard error format with categories", "Output schema validation feeds trust graph", "Capability standards library (write_report, send_notification)", "AI translation contract and caching"],
    prompt: "SECTION 5: STRUCTURED I/O CONTRACTS\nClassification: REQUIRED for schemas, OPTIONAL for validation middleware\n\n== DEVELOPER CONFIG ==\n\n{\n  \"validation\": {\n    \"strict_mode\": true,\n    \"reject_extra_fields\": false,\n    \"coerce_types\": true\n  },\n  \"error_format\": \"signalpot/error@v1\",\n  \"response_envelope\": \"signalpot/envelope@v1\"\n}\n\n== PLATFORM SPEC ==\n\n5.1 \u2014 Standard Envelopes (REQUIRED, every message)\n  Request: { task_id, caller, capability, standard, input, metadata }\n  Response: { task_id, status, output, error, metrics }\n  Developer owns input/output. Platform owns the wrapper.\n\n5.2 \u2014 Standard Error Format (signalpot/error@v1)\n  { code, message, category, retryable, retry_after_ms, details }\n  Categories: input, execution, dependency, platform\n\n  Platform errors: TRUST_INSUFFICIENT, RATE_LIMITED, INVALID_SCHEMA,\n    AGENT_UNAVAILABLE, BUDGET_EXCEEDED, TOKEN_EXPIRED, TRANSLATION_FAILED\n  Developer defines their own domain-specific error codes\n\n5.3 \u2014 Schema Validation Pipeline\n  Inbound (optional): platform validates input if strict_mode on\n  Outbound (REQUIRED): platform ALWAYS validates output against schema\n    Valid output > trust event: schema_valid\n    Invalid output > trust event: schema_invalid (still delivered)\n    Soft enforcement: bad output hurts trust, doesn't block delivery\n\n5.4 \u2014 Standard Capability Interfaces\n  signalpot/write_report@v1: { title, data, format, audience } > { report_content, format }\n  signalpot/send_notification@v1: { channel, recipient, body, priority } > { delivered, delivery_id }\n  Stored in capability_standards table\n  Agents declare conformity at registration\n  Discovery matches standards first, tags second\n\n5.5 \u2014 Schema Versioning\n  Minor: additive only, backward compatible\n  Major: breaking, deprecation period enforced\n  Platform tracks schema history per agent\n\n5.6 \u2014 AI Translation Contract\n  Cached field mappings per schema pair\n  Translation cost logged separately\n  Invalidates on schema change",
    dependencyNote: "Needs interface (2) and core logic (4) for I/O shapes.",
    classification: "REQUIRED / OPTIONAL"
  },
  {
    id: 6, title: "Observability & Logging", subtitle: "Visibility & Disputes",
    icon: "\u25c8", deps: [3, 4, 5], status: "locked" as const,
    description: "Trust event emission, logging, dashboards, trace chains across agent hires, degradation detection, and dispute resolution system.",
    keyItems: ["Trust events auto-emitted (REQUIRED)", "Platform logging and dashboards (optional)", "Trace chain across agent-to-agent calls", "Degradation detection and auto-recovery", "3-tier dispute resolution with deposits"],
    prompt: "SECTION 6: OBSERVABILITY & LOGGING\nClassification: REQUIRED for trust events, OPTIONAL for dashboards/logging\n\n== DEVELOPER CONFIG ==\n\n{\n  \"observability\": {\n    \"emit_trust_events\": true,\n    \"use_platform_logging\": true,\n    \"use_platform_dashboard\": true,\n    \"custom_metrics\": [\"mentions_per_cycle\", \"escalations\", \"avg_sentiment\"],\n    \"log_retention_days\": 90,\n    \"alert_on_error_rate\": 0.20\n  }\n}\n\n== PLATFORM SPEC ==\n\n6.1 \u2014 Layer 1: Trust Events (REQUIRED, auto-emitted)\n  Inbound: task_received, task_started, task_completed/failed, schema_valid/invalid\n  Outbound: hire_requested, hire_completed/failed, translation_used\n  Feedback: caller_satisfied, caller_disputed\n\n6.2 \u2014 Layer 2: Platform Logging (OPTIONAL)\n  SDK logger: logger.info/warn/error with structured context\n  If opted out, developer uses their own logging\n\n6.3 \u2014 Layer 3: Platform Dashboard (OPTIONAL)\n  Public marketplace page shows: tasks completed, success rate,\n  avg latency, trust trend, error rate, unique callers\n  Private developer view adds logs and revenue data\n\n6.4 \u2014 Trace Chain\n  trace_id propagates across agent-to-agent calls\n  Table: trace_spans { trace_id, span_id, parent_span_id, agent_id, ... }\n  Platform-managed, developer doesn't instrument\n\n6.5 \u2014 Degradation Detection\n  Error rate > alert_threshold (20%) > status: degraded\n  Error rate > 50% for 15min > status: suspended\n  Recovery: error rate drops for 10min > auto-restore to active\n\n6.6 \u2014 Dispute Resolution System\n  Tier 1: AI Resolution (instant, confidence >= 0.85 auto-resolves)\n    Reviews input, output, schemas, dispute reason\n  Tier 2: Community Panel (24-48h)\n    5 high-trust agents, anonymized, majority vote\n    Panelists earn review fee, build review reputation\n  Tier 3: Platform Review (manual, final)\n\n  Deposits: both parties stake 2x transaction cost\n  Winner gets deposit back + portion of loser's\n  Platform keeps portion for dispute reserve\n  Anti-gaming: frequent frivolous filers get doubled deposit requirements\n\n6.7 \u2014 Cost Tracking\n  Per-interaction: { platform_fee, compute_cost, translation_cost, hired_agent_cost }",
    dependencyNote: "Needs trust (3), execution (4), and I/O (5) to instrument.",
    classification: "REQUIRED / OPTIONAL"
  },
  {
    id: 7, title: "Billing & Metering", subtitle: "Economics",
    icon: "\u2b20", deps: [3, 4, 6], status: "locked" as const,
    description: "Platform fees, dispute reserve, deposit escrow, metering, settlement, and economic cost defense against trust gaming.",
    keyItems: ["Agent fee + platform fee (10%) + reserve (2%)", "Dispute reserve pool (self-sustaining)", "Deposit escrow with 50/50 loser split", "Full cost chain for multi-agent interactions", "Economic cost defense ($0.001 minimum)"],
    prompt: "SECTION 7: BILLING & METERING\nClassification: REQUIRED for economic cost minimum, OPTIONAL for platform billing\n\n== DEVELOPER CONFIG ==\n\n{\n  \"pricing\": {\n    \"model\": \"per_request\",\n    \"rates\": { \"monitor_brand\": 0.05, \"get_sentiment_report\": 0.005 },\n    \"free_tier\": { \"enabled\": true, \"monthly_requests\": 100 },\n    \"budget_cap_default\": 0.10\n  }\n}\n\n== PLATFORM SPEC ==\n\n7.1 \u2014 Fee Structure\n  Total = Agent fee + Platform fee (10%, min $0.001) + Reserve (2% of agent fee)\n  Free tier still pays platform minimum (economic cost defense)\n\n7.2 \u2014 Dispute Reserve Pool\n  Inflows: 2% of every agent fee + platform cut from loser deposits\n  Outflows: Tier 1 AI costs + Tier 2 panelist fees\n  Tier 3 covered by SignalPot operating budget\n\n7.3 \u2014 Deposit Escrow\n  Both parties stake 2x transaction cost\n  Winner: deposit + refund + 50% of loser's deposit\n  Platform: 50% of loser's deposit to reserve\n\n7.4 \u2014 Metering\n  Table: usage_records { task_id, agent_fee, platform_fee, reserve, total }\n  Table: outbound_costs { hired_agent_fee, platform_fee, translation_cost }\n  Full cost chain visible for multi-agent interactions\n\n7.5 \u2014 Settlement\n  Real-time: caller debited, fees taken, agent fee pending\n  Daily: pending balances settled, outbound costs deducted\n  Monthly: full statement with breakdown\n\n7.6 \u2014 Developer Revenue Dashboard\n  Revenue, costs, net margin, per-capability breakdown,\n  hiring cost trends, dispute impact, projected revenue\n\n7.7 \u2014 Caller Cost Controls\n  budget_cap, monthly_limit, alert_at_percentage\n  Platform enforces before processing\n\n7.8 \u2014 Economic Cost Defense\n  $0.001 minimum per transaction\n  Trust-per-dollar-spent weighting\n  Low cost + high trust = suspicious, flagged for review",
    dependencyNote: "Needs auth (3), execution (4), and observability (6).",
    classification: "REQUIRED / OPTIONAL"
  },
  {
    id: 8, title: "Error Handling & Resilience", subtitle: "Safety Net",
    icon: "\u23e2", deps: [2, 4, 5], status: "locked" as const,
    description: "Error categories, retry logic, circuit breakers, fallback chains, cascading failure prevention. Developer-owned with platform SDK patterns.",
    keyItems: ["4 error categories (input/execution/dependency/platform)", "Exponential backoff retries", "Per-dependency circuit breakers", "Graceful fallback chains", "Health endpoint for degradation detection"],
    prompt: "SECTION 8: ERROR HANDLING & RESILIENCE\nClassification: DEVELOPER OWNED (platform provides standards and SDK patterns)\n\n== DEVELOPER CONFIG ==\n\n{\n  \"resilience\": {\n    \"retry_policy\": \"exponential_backoff\",\n    \"max_retries\": 3,\n    \"circuit_breaker_threshold\": 0.50,\n    \"circuit_breaker_window_minutes\": 5,\n    \"degraded_after_consecutive_failures\": 3,\n    \"fallback_behavior\": \"graceful\"\n  }\n}\n\n== DEVELOPER SPEC ==\n\n8.1 \u2014 Error Categories\n  input: caller sent bad data (no trust impact on agent)\n  execution: agent logic failed (trust impact if persistent)\n  dependency: external service failed (reduced trust impact)\n  platform: SignalPot infra issue (no trust impact)\n\n8.2 \u2014 Error Taxonomy\n  Input: BRAND_NAME_REQUIRED, MONITOR_NOT_FOUND, MONITOR_LIMIT_REACHED...\n  Execution: SCORING_FAILED, SCHEDULER_FAILED, DATABASE_WRITE_FAILED...\n  Dependency: SOURCE_API_UNAVAILABLE, HIRED_AGENT_TIMEOUT, LLM_API_DOWN...\n\n8.3 \u2014 Retry Logic (SDK pattern: withRetry)\n  Retry transient, abort permanent\n  For hiring: retry same agent once, then next candidate, then fallback\n\n8.4 \u2014 Circuit Breakers (SDK pattern: CircuitBreaker)\n  CLOSED > OPEN (at threshold) > HALF-OPEN (cooldown) > test > CLOSED\n  Independent breaker per external dependency\n\n8.5 \u2014 Fallback Behaviors\n  Sources down: continue with partial data, flag in report\n  Scoring down: fall back to local model\n  Hiring fails: send basic alert without report\n  Everything down: store event, retry next cycle\n  Principle: always give caller something useful\n\n8.6 \u2014 Cascading Failure Prevention\n  Upstream: independent circuit breakers, partial data OK\n  Downstream: timeout enforcement, candidate rotation, budget cap\n  Self: scheduler skip logic, memory caps, concurrency limits\n\n8.7 \u2014 Health Endpoint\n  GET /health returns: { status, version, checks: {per dependency}, error_rate }\n  Feeds platform degradation detection\n\n8.8 \u2014 Error Responses\n  Follow signalpot/error@v1 with enough detail for callers to act\n  Include degraded_sources, active_sources, retry guidance",
    dependencyNote: "Parallel with 4-5. Needs interface (2), execution (4), I/O (5).",
    classification: "DEVELOPER OWNED"
  },
  {
    id: 9, title: "Versioning & Deployment", subtitle: "Ship It",
    icon: "\u2b23", deps: [1, 2, 5], status: "locked" as const,
    description: "Version registry, semver rules, multi-version routing, deployment freedom, CI/CD with CLI and GitHub Actions.",
    keyItems: ["Version registry with breaking change detection", "Multi-version routing for callers", "Deploy anywhere (3 requirements only)", "CLI + GitHub Action for publishing", "Rollback support"],
    prompt: "SECTION 9: VERSIONING & DEPLOYMENT\nClassification: DEVELOPER OWNED (platform tracks versions in registry)\n\n== DEVELOPER CONFIG ==\n\n{\n  \"versioning\": { \"current\": \"1.0.0\", \"deprecation_notice_days\": 30 },\n  \"deployment\": {\n    \"target\": \"vercel\",\n    \"health_endpoint\": \"/api/agents/brand-reputation-monitor/health\",\n    \"env_vars\": [\"SIGNALPOT_AGENT_ID\", \"SIGNALPOT_OUTBOUND_TOKEN\",\n                  \"TWITTER_API_KEY\", \"REDDIT_API_KEY\", \"ANTHROPIC_API_KEY\",\n                  \"SUPABASE_URL\", \"SUPABASE_KEY\"]\n  }\n}\n\n== PLATFORM SPEC ==\n\n9.1 \u2014 Version Registry\n  Table: agent_versions { version, status, changelog, breaking, published_at }\n  Auto-detects breaking changes by comparing schemas\n  Notifies callers on breaking changes\n\n9.2 \u2014 Versioning Rules\n  Patch (1.0.1): bug fixes, no schema changes\n  Minor (1.1.0): additive fields/capabilities, non-breaking\n  Major (2.0.0): breaking changes, deprecation period enforced\n\n9.3 \u2014 Multi-Version Routing\n  Callers specify \"1.x\" or \"2.0.0\" or omit for latest stable\n  Platform routes to correct version\n\n9.4 \u2014 Deployment Requirements (platform mandates only 3 things)\n  1. MCP endpoint reachable\n  2. Health endpoint responds\n  3. A2A Agent Card at /.well-known/agent.json\n  Everything else is developer's choice\n\n9.5 \u2014 CI/CD\n  CLI: signalpot publish --version 1.1.0 --changelog \"...\"\n  GitHub Action: signalpot/publish-action@v1\n  Validates schemas, detects breaking, publishes, notifies\n\n9.6 \u2014 Rollback\n  signalpot rollback --to 1.0.0\n  Reverts registry, developer handles code rollback\n\n9.7 \u2014 Secrets\n  Platform provides: SIGNALPOT_AGENT_ID, SIGNALPOT_OUTBOUND_TOKEN\n  Developer manages all third-party credentials\n  SignalPot never touches external API keys",
    dependencyNote: "Needs manifest (1), interface (2), I/O contracts (5).",
    classification: "DEVELOPER OWNED"
  },
  {
    id: 10, title: "Testing & Validation", subtitle: "Prove It",
    icon: "\u25c7", deps: [1, 2, 3, 4, 5, 6, 7, 8, 9], status: "locked" as const,
    description: "4-layer testing: unit tests, integration with sandbox, platform test harness, marketplace certification. Trust starts at 0.1 after certification.",
    keyItems: ["Unit tests (developer framework)", "Integration tests with platform sandbox", "Platform test harness (automated compliance)", "Marketplace certification gate", "Post-launch monitoring and schema drift detection"],
    prompt: "SECTION 10: TESTING & VALIDATION\nClassification: DEVELOPER OWNED (platform provides sandbox and test harness)\n\n== DEVELOPER CONFIG ==\n\n{\n  \"testing\": {\n    \"use_platform_sandbox\": true,\n    \"use_platform_test_harness\": true,\n    \"pre_publish_validation\": true\n  }\n}\n\n== TESTING LAYERS ==\n\nLayer 1: Unit Tests (developer writes and runs)\n  Test each internal tool in isolation\n  Developer's choice of framework\n\nLayer 2: Integration Tests (developer writes, uses platform sandbox)\n  Sandbox provides: mock agents, configurable trust scores, test billing\n  CLI: signalpot sandbox start\n  Test scenarios: happy path, hiring with constraints, partial failure,\n    tier enforcement, AI translation, dispute flow\n\nLayer 3: Platform Test Harness (platform provides, runs on publish)\n  MCP compliance: initialize, list_tools, call_tool\n  A2A compliance: Agent Card, task endpoints\n  Schema compliance: input validation, output validation\n  Error handling: proper codes, categories, no crashes\n  Trust integration: threshold enforcement, event emission\n  Billing: fee calculation, budget caps\n  Returns structured report: pass/fail per category\n\nLayer 4: Marketplace Certification (automated gate)\n  All Layer 3 tests pass\n  Health endpoint responsive for 24 hours\n  10+ successful sandbox transactions\n  No security issues detected\n  Response times within declared latency (2x tolerance)\n  Hiring agents: successfully hired mock agents\n  Pass = status changes to active, trust starts at 0.1\n\nPost-Launch Monitoring:\n  Synthetic health checks every 60s\n  Schema drift detection (periodic test requests)\n  Trust anomaly detection",
    dependencyNote: "Depends on everything - validates the whole agent.",
    classification: "DEVELOPER OWNED"
  }
];

type SectionStatus = "completed" | "active" | "locked";

interface Section {
  id: number;
  title: string;
  subtitle: string;
  icon: string;
  deps: number[];
  status: SectionStatus;
  description: string;
  keyItems: string[];
  prompt: string;
  dependencyNote: string;
  classification: string;
}

const statusColors: Record<SectionStatus, { bg: string; border: string; text: string; glow: string }> = {
  completed: { bg: "#0a2e1a", border: "#22c55e", text: "#4ade80", glow: "0 0 20px rgba(34,197,94,0.3)" },
  active: { bg: "#1a1a0a", border: "#eab308", text: "#facc15", glow: "0 0 20px rgba(234,179,8,0.3)" },
  locked: { bg: "#1a1a1f", border: "#3f3f46", text: "#71717a", glow: "none" },
};

const criticalPath = [1, 2, 3, 4, 5, 6, 7];
const classColors: Record<string, string> = { "REQUIRED": "#ef4444", "REQUIRED / OPTIONAL": "#f59e0b", "DEVELOPER OWNED": "#3b82f6" };

export default function AgentBuildoutTracker() {
  const [data, setData] = useState<Section[]>(sections);
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<"map" | "list">("map");
  const [promptExpanded, setPromptExpanded] = useState(false);

  const completedCount = data.filter((s) => s.status === "completed").length;
  const progress = (completedCount / data.length) * 100;

  const getAvailableSections = (list: Section[]): Section[] => {
    const done = list.filter((s) => s.status === "completed").map((s) => s.id);
    return list.map((s) => {
      if (s.status === "completed") return s;
      return { ...s, status: (s.deps.every((d) => done.includes(d)) ? "active" : "locked") as SectionStatus };
    });
  };

  const toggleComplete = (id: number) => {
    setData((prev) =>
      getAvailableSections(
        prev.map((s) =>
          s.id === id ? { ...s, status: (s.status === "completed" ? "active" : "completed") as SectionStatus } : s
        )
      )
    );
  };

  const sel = data.find((s) => s.id === selected) || null;

  const renderPrompt = (prompt: string | undefined) => {
    if (!prompt) return <div style={{ fontSize: 12, color: "#3f3f46", fontStyle: "italic" }}>Not yet drafted</div>;
    const lines = prompt.split("\n");
    return (
      <div style={{ maxHeight: promptExpanded ? "none" : 300, overflowY: promptExpanded ? "visible" : "auto", paddingRight: 4 }}>
        {lines.map((line, i) => {
          if (line.startsWith("SECTION ") || line.startsWith("Classification:")) {
            return <div key={i} style={{ fontSize: 12, color: "#e4e4e7", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 2, marginTop: i > 0 ? 4 : 0 }}>{line}</div>;
          }
          if (line.startsWith("== ") && line.endsWith(" ==")) {
            return <div key={i} style={{ fontSize: 10, color: "#eab308", letterSpacing: 2, fontWeight: 600, marginTop: 12, marginBottom: 4 }}>{line.replace(/=/g, "").trim()}</div>;
          }
          if (line.match(/^\d+\.\d+ /)) {
            return <div key={i} style={{ fontSize: 11, color: "#facc15", fontWeight: 600, marginTop: 8, marginBottom: 2 }}>{line}</div>;
          }
          if (line.match(/^-{3,}/) || line.match(/^={3,}/)) return null;
          if (line.trim() === "") return <div key={i} style={{ height: 6 }} />;
          return <div key={i} style={{ fontSize: 11, color: "#a1a1aa", lineHeight: 1.6, paddingLeft: line.startsWith("  ") ? 12 : 0 }}>{line}</div>;
        })}
      </div>
    );
  };

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", background: "#0c0c0f", color: "#e4e4e7", minHeight: "100vh", padding: "24px", boxSizing: "border-box" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #18181b; }
        ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
        @keyframes pulseGlow { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#eab308", boxShadow: "0 0 12px rgba(234,179,8,0.6)", animation: "pulseGlow 2s ease-in-out infinite" }} />
            <span style={{ fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: "#a1a1aa" }}>SignalPot</span>
          </div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: -1, background: "linear-gradient(135deg, #e4e4e7 0%, #a1a1aa 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Agent Buildout Tracker
          </h1>
          <p style={{ fontSize: 12, color: "#71717a", margin: "6px 0 0 0" }}>Build your AI agent step by step &middot; MCP/A2A &middot; {completedCount}/{data.length} complete</p>
        </div>
        <div style={{ minWidth: 220 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "#71717a" }}>BUILD PROGRESS</span>
            <span style={{ fontSize: 11, color: "#eab308", fontWeight: 600 }}>{Math.round(progress)}%</span>
          </div>
          <div style={{ height: 4, background: "#27272a", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, borderRadius: 2, background: "linear-gradient(90deg, #eab308, #22c55e)", transition: "width 0.5s ease" }} />
          </div>
        </div>
      </div>

      {/* View Toggle */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "#18181b", borderRadius: 8, padding: 4, width: "fit-content" }}>
        {(["map", "list"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} style={{ padding: "8px 20px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "inherit", letterSpacing: 1, textTransform: "uppercase", background: view === v ? "#27272a" : "transparent", color: view === v ? "#e4e4e7" : "#71717a" }}>
            {v === "map" ? "Dependency Map" : "Section List"}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {/* Left: Cards/List */}
        <div style={{ flex: "1 1 480px", minWidth: 0 }}>
          {view === "map" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {data.map((s, i) => {
                const c = statusColors[s.status];
                const isCrit = criticalPath.includes(s.id);
                const isSel = selected === s.id;
                return (
                  <div key={s.id} onClick={() => s.status !== "locked" ? setSelected(s.id) : null}
                    style={{ background: isSel ? c.bg : "#14141a", border: `1.5px solid ${isSel ? c.border : s.status === "locked" ? "#27272a" : c.border}`, borderRadius: 10, padding: 16, cursor: s.status === "locked" ? "default" : "pointer", opacity: s.status === "locked" ? 0.5 : 1, boxShadow: isSel ? c.glow : "none", transition: "all 0.25s", animation: `slideIn 0.3s ease ${i * 0.04}s both`, position: "relative" }}>
                    {isCrit && <div style={{ position: "absolute", top: 8, right: 8, fontSize: 8, padding: "2px 6px", borderRadius: 4, background: "#eab30815", color: "#eab308", border: "1px solid #eab30830", letterSpacing: 1.5 }}>CRITICAL</div>}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 18, color: c.text }}>{s.icon}</span>
                      <span style={{ fontSize: 11, color: "#52525b", fontWeight: 600 }}>{String(s.id).padStart(2, "0")}</span>
                      <span style={{ fontSize: 7, padding: "1px 5px", borderRadius: 3, background: (classColors[s.classification] || "#666") + "20", color: classColors[s.classification] || "#666", marginLeft: "auto", letterSpacing: 0.5 }}>{s.classification}</span>
                    </div>
                    <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 600, color: c.text, marginBottom: 4, lineHeight: 1.3 }}>{s.title}</div>
                    <div style={{ fontSize: 11, color: "#52525b" }}>{s.subtitle}</div>
                    {s.deps.length > 0 && <div style={{ marginTop: 10, display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {s.deps.map((d) => { const dep = data.find((x) => x.id === d); const done = dep && dep.status === "completed"; return <span key={d} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: done ? "#22c55e20" : "#27272a", color: done ? "#4ade80" : "#52525b", border: `1px solid ${done ? "#22c55e40" : "#3f3f46"}` }}>S{d}</span>; })}
                    </div>}
                    {s.status === "completed" && <div style={{ position: "absolute", bottom: 8, right: 8, fontSize: 14, color: "#22c55e" }}>{"\u2713"}</div>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.map((s, i) => {
                const c = statusColors[s.status];
                return (
                  <div key={s.id} onClick={() => s.status !== "locked" ? setSelected(s.id) : null}
                    style={{ display: "flex", alignItems: "center", gap: 12, background: selected === s.id ? c.bg : "#14141a", border: `1px solid ${selected === s.id ? c.border : "#1e1e24"}`, borderRadius: 8, padding: "12px 16px", cursor: s.status === "locked" ? "default" : "pointer", opacity: s.status === "locked" ? 0.45 : 1, transition: "all 0.2s", animation: `slideIn 0.2s ease ${i * 0.03}s both` }}>
                    <span style={{ fontSize: 16, color: c.text, width: 24 }}>{s.icon}</span>
                    <span style={{ fontSize: 11, color: "#52525b", fontWeight: 600, width: 24 }}>{String(s.id).padStart(2, "0")}</span>
                    <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 500, color: c.text, flex: 1 }}>{s.title}</span>
                    <span style={{ fontSize: 7, padding: "2px 5px", borderRadius: 3, background: (classColors[s.classification] || "#666") + "20", color: classColors[s.classification] || "#666" }}>{s.classification}</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {s.deps.map((d) => { const dep = data.find((x) => x.id === d); const done = dep && dep.status === "completed"; return <span key={d} style={{ fontSize: 9, padding: "2px 5px", borderRadius: 3, background: done ? "#22c55e20" : "#27272a", color: done ? "#4ade80" : "#52525b" }}>S{d}</span>; })}
                    </div>
                    <span style={{ fontSize: 10, color: c.text, letterSpacing: 1, textTransform: "uppercase", width: 50, textAlign: "right" }}>{s.status === "completed" ? "Done" : s.status === "active" ? "Ready" : "Locked"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Detail Panel */}
        <div style={{ flex: "0 0 400px", maxWidth: 440, background: "#14141a", border: "1px solid #1e1e24", borderRadius: 12, padding: 24, height: "fit-content", position: "sticky", top: 24 }}>
          {sel ? (
            <div style={{ animation: "slideIn 0.25s ease" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 22, color: statusColors[sel.status].text }}>{sel.icon}</span>
                  <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: statusColors[sel.status].bg, color: statusColors[sel.status].text, border: `1px solid ${statusColors[sel.status].border}`, letterSpacing: 1, textTransform: "uppercase" }}>{sel.status}</span>
                  <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: (classColors[sel.classification] || "#666") + "15", color: classColors[sel.classification] || "#666", border: `1px solid ${(classColors[sel.classification] || "#666")}30` }}>{sel.classification}</span>
                </div>
                <button onClick={() => { setSelected(null); setPromptExpanded(false); }} style={{ background: "none", border: "none", color: "#52525b", fontSize: 18, cursor: "pointer", padding: 4 }}>{"\u00D7"}</button>
              </div>
              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: "0 0 4px 0", color: statusColors[sel.status].text }}>{sel.title}</h2>
              <p style={{ fontSize: 12, color: "#71717a", margin: "0 0 16px 0", lineHeight: 1.6 }}>{sel.description}</p>
              <div style={{ background: "#0c0c0f", borderRadius: 8, padding: 12, marginBottom: 12, border: "1px solid #1e1e24" }}>
                <div style={{ fontSize: 10, color: "#52525b", letterSpacing: 2, marginBottom: 6, textTransform: "uppercase" }}>Dependencies</div>
                <div style={{ fontSize: 12, color: "#a1a1aa", lineHeight: 1.5 }}>{sel.dependencyNote}</div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: "#52525b", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>Key Components</div>
                {sel.keyItems.map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6, fontSize: 12, color: "#a1a1aa", lineHeight: 1.5 }}>
                    <span style={{ color: statusColors[sel.status].text, fontSize: 8, marginTop: 4, flexShrink: 0 }}>{"\u25CF"}</span>{item}
                  </div>
                ))}
              </div>
              <div style={{ background: "#0c0c0f", borderRadius: 8, padding: 12, border: "1px solid #1e1e24", marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: "#52525b", letterSpacing: 2, textTransform: "uppercase" }}>Buildout Prompt</div>
                  {sel.prompt && <button onClick={() => setPromptExpanded(!promptExpanded)} style={{ background: "none", border: "1px solid #27272a", borderRadius: 4, color: "#71717a", fontSize: 10, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit" }}>{promptExpanded ? "Collapse" : "Expand"}</button>}
                </div>
                {renderPrompt(sel.prompt)}
              </div>
              {sel.status !== "locked" && (
                <button onClick={() => toggleComplete(sel.id)}
                  style={{ width: "100%", padding: "10px 16px", background: sel.status === "completed" ? "#27272a" : "#1a1a0a", border: `1px solid ${sel.status === "completed" ? "#3f3f46" : "#eab30850"}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 12, letterSpacing: 1, color: sel.status === "completed" ? "#a1a1aa" : "#eab308" }}>
                  {sel.status === "completed" ? "REOPEN SECTION" : "MARK COMPLETE"}
                </button>
              )}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>{"\u25C6"}</div>
              <div style={{ fontSize: 13, color: "#3f3f46" }}>Select a section to view details</div>
              <div style={{ fontSize: 11, color: "#27272a", marginTop: 8 }}>Yellow = ready | Green = complete | Click to drill in</div>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ marginTop: 32, padding: "16px 20px", background: "#14141a", border: "1px solid #1e1e24", borderRadius: 10, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 10, color: "#52525b", letterSpacing: 2, textTransform: "uppercase" }}>Legend</div>
        {[{ l: "Ready", c: "#eab308" }, { l: "Complete", c: "#22c55e" }, { l: "Locked", c: "#3f3f46" }].map((x) => (
          <div key={x.l} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: x.c }} /><span style={{ fontSize: 11, color: "#71717a" }}>{x.l}</span>
          </div>
        ))}
        <div style={{ borderLeft: "1px solid #27272a", paddingLeft: 16, display: "flex", gap: 12 }}>
          {[{ l: "Required", c: "#ef4444" }, { l: "Req/Optional", c: "#f59e0b" }, { l: "Dev Owned", c: "#3b82f6" }].map((x) => (
            <div key={x.l} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 3, borderRadius: 1, background: x.c }} /><span style={{ fontSize: 11, color: "#71717a" }}>{x.l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
