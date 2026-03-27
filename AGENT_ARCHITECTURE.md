# Agent Architecture

A general-purpose architecture for building agents and agent suites on a Next.js + Supabase stack. Battle-tested through the Analyst Suite build (4 sub-agents, 13 capabilities, 10 tables, 11 API routes). Designed for continuous agent buildout — every new agent strengthens the ecosystem, and every agent can call every other agent.

---

## Core Philosophy

- **Engines are pure logic** — no HTTP, no auth, no framework coupling. They take a DB client and owner ID, do work, return results. This makes them callable from anywhere: API routes, dispatch, other engines, cron jobs, or future orchestration layers.
- **API routes are thin wrappers** — auth check, validate input, call engine, format response. Nothing else.
- **Dispatch is the universal interface** — the internal endpoint that maps capability strings to engine functions. This is what makes agent-to-agent communication possible. One dispatch per suite, addressable by any agent in the ecosystem.
- **Templates over hardcoding** — configurable JSON params drive output, not bespoke code per use case. Users and agents alike define what they want through the same parameter interface.
- **One table per concern** — separate storage for rules, runs, anomalies, templates. Clean boundaries mean agents can read each other's state without coupling to each other's logic.
- **Every agent enriches the data layer** — agents don't just process and respond. They write their findings, decisions, and artifacts back to the database. This means downstream agents inherit the work of upstream agents without needing to repeat it.

---

## Agent-to-Agent Interaction Model

This is the most important section. The architecture is not a collection of isolated tools — it's an ecosystem where agents compose, chain, and build on each other's output.

### The Dispatch Contract

Every agent suite exposes a single dispatch endpoint. The contract is universal:

```
POST /api/{suite}/dispatch
Header: x-internal-key: {secret}
Body: { capability: "verb.action", input: { ... }, job_id: "uuid" }
```

This means:
- **Any agent can call any other agent's capabilities** through the dispatch contract
- **The job system is the orchestrator** — it creates a job, resolves the right dispatch endpoint, calls it, and records the result
- **Agents don't import each other's code** — they communicate through capability calls, keeping coupling at zero

### Data as the Shared Language

Agents don't pass raw data between each other. They write to shared tables, and downstream agents read from them. This is intentional:

```
Rosetta normalizes records    → writes to analyst_records (entity_mappings, normalized_values)
Sentinel validates records    → reads analyst_records, writes to analyst_validation_runs + record flags
Pathfinder detects anomalies  → reads analyst_records + flags, writes to analyst_anomalies
Brief compiles output         → reads analyst_records + anomalies + any table it needs
```

Each agent enriches the data layer. By the time Brief runs, the records carry:
- Raw values (from import)
- Normalized values (from Rosetta)
- Entity mappings (from Rosetta)
- Validation flags (from Sentinel)
- Anomaly markers (from Pathfinder)

No agent had to ask another agent for this data. It's already there. This is the efficiency: **each agent does its job once, and every subsequent agent benefits**.

### Chaining Patterns

**Sequential chain** — agents run in order, each building on the last:
```
Import → Rosetta (normalize) → Sentinel (validate) → Pathfinder (investigate) → Brief (compile)
```

**Fan-out** — one event triggers multiple agents:
```
New dataset uploaded → Rosetta normalizes → { Sentinel validates, Pathfinder scans } → Brief compiles
```

**On-demand** — user or agent triggers a specific capability:
```
User clicks "Explain" on anomaly → Pathfinder.explain → writes explanation to analyst_anomalies
Brief reads it next time it compiles → includes explanation in the report automatically
```

**Cross-suite** — agents in different suites interact through dispatch:
```
Suite A detects a trend → calls Suite B's dispatch: { capability: "alert.notify", input: { ... } }
Suite B's engine processes the alert → writes to its own tables
```

### Why This Matters

Traditional agent architectures require explicit wiring between every pair of agents. N agents = N^2 potential connections. Here, agents interact through two mechanisms:

1. **Dispatch calls** — for active requests ("do this thing")
2. **Shared data layer** — for passive enrichment ("read what others have already done")

This means adding a new agent to the ecosystem is O(1) effort — it reads from existing tables and writes to its own. No existing agent needs to change.

---

## The Efficiency Layer

Each agent has a specific efficiency thesis — what it eliminates, what it accelerates, and what it enables for the rest of the ecosystem.

### Rosetta (Normalizer)

**Eliminates**: Manual data cleaning and entity matching across vendor sources. What used to be a human spreadsheet exercise — "is 'P&G' the same as 'Procter & Gamble'?" — is resolved algorithmically, with an LLM fallback for ambiguous cases.

**Accelerates**: Time-to-analysis. Raw data becomes analysis-ready in a single pass. The two-phase approach (fast-pass for obvious matches, smart-pass for hard cases) means 80-90% of names resolve instantly, with Claude handling the long tail.

**Enables for the ecosystem**: A canonical entity layer that every downstream agent can rely on. When Sentinel checks a validation rule against "brand", it doesn't need to worry about whether the data says "P&G" or "Procter & Gamble" — Rosetta already resolved it. The `entity_mappings` field on every record is Rosetta's gift to the ecosystem.

**Learning loop**: `normalize.learn` records user corrections. Every correction makes future matching faster and more accurate. The alias table grows over time, reducing smart-pass (LLM) calls and their associated cost and latency.

### Sentinel (Validator)

**Eliminates**: Manually eyeballing data for quality issues. Configurable rules catch missing fields, out-of-range values, cross-source inconsistencies, and statistical outliers — automatically, every time data is processed.

**Accelerates**: Trust. Validated data can flow into reports and decisions without manual review. The severity system (error/warning/info) lets users decide their own confidence threshold.

**Enables for the ecosystem**: A quality signal on every record. The `flags` array on `analyst_records` and the `validation_summary` on `analyst_datasets` tell any downstream agent "how clean is this data?" Brief can include a data quality score. Pathfinder can prioritize investigating records that Sentinel already flagged. The validation run history provides an audit trail.

**Compounding value**: Rules are reusable across datasets. Define "market share must be between 0 and 100" once, and it applies to every future dataset automatically.

### Pathfinder (Investigator)

**Eliminates**: The detective work of figuring out why a number looks wrong. Instead of manually drilling through dimensions trying to find the outlier, Pathfinder does the statistical scan and surfaces the anomalies with z-scores and severity.

**Accelerates**: Root cause analysis. The LLM explain capability takes an anomaly's context (the value, surrounding data, entity mappings) and generates a human-readable hypothesis. What would take an analyst 30 minutes of context-gathering happens in one API call.

**Enables for the ecosystem**: A structured anomaly layer. The `analyst_anomalies` table gives every other agent a queryable set of "things that look wrong" with statistical context, status tracking, and optional LLM explanations. Brief can pull anomalies into reports. Future agents could trigger alerts, update dashboards, or initiate automated remediation based on anomaly severity.

**Status workflow**: Anomalies move through open → acknowledged → resolved/false_positive. This creates a feedback loop — false positives inform rule tuning in Sentinel, and resolved anomalies become part of the historical context.

### Brief (Compiler)

**Eliminates**: Manual report building, slide creation, and chart configuration. The template system means users define their output format once and reuse it with fresh data.

**Accelerates**: Insight delivery. Data goes from normalized → validated → compiled in a pipeline, not a manual process. The four output types (report, slide, table, chart) cover the most common presentation formats.

**Enables for the ecosystem**: A template layer that any agent can call. An autonomous agent could detect a trend, investigate it, and compile a report — all without human involvement. The template system is the key: it separates "what to show" (template params) from "what data to use" (dataset selection), making Brief a general-purpose output engine.

**Template composability**: Templates are JSON — they can be generated by other agents, stored and versioned, shared between users, or evolved over time. An LLM agent could generate a template based on a natural language request, then Brief executes it.

---

## Agent Anatomy

Every agent follows the same structural pattern:

```
Database tables     →  Store domain data + operational state
Engine (lib/)       →  Core logic, isolated from HTTP
API routes (app/)   →  Frontend-facing endpoints (auth'd via session/API key)
Dispatch wiring     →  Internal endpoint called by the job system (auth'd via internal key)
Seed script         →  Registers the agent + capabilities in the agents table
Dashboard UI        →  Tab or page for user interaction
```

### Suites vs Standalone

- **Suite**: A parent agent with sub-agents. The parent has the dispatch endpoint; sub-agents are logical groupings of capabilities. Example: Analyst Suite (parent) → Rosetta, Sentinel, Pathfinder, Brief (sub-agents).
- **Standalone**: A single agent with its own dispatch endpoint and capabilities.

### When to Use a Suite

Use a suite when you have multiple agents that:
- Operate on the same data domain (same tables, same entity model)
- Chain naturally (output of one feeds the next)
- Share a dispatch endpoint (simpler routing)

Use standalone when:
- The agent has a distinct domain with no data overlap
- It doesn't chain with other agents in a predictable sequence
- It needs its own dispatch endpoint for isolation

---

## File Layout

```
src/
  lib/
    {suite-name}/
      {agent-name}/
        engine.ts          # Orchestrator — main entry points
        rules.ts           # Domain logic (if needed, e.g. rule executors)

  app/
    api/
      {suite-name}/
        dispatch/
          route.ts         # Internal dispatch endpoint (all capabilities routed here)
        {resource}/
          route.ts         # Frontend CRUD endpoints (GET/POST/PATCH/DELETE)

    dashboard/
      {suite-name}/
        page.tsx           # Dashboard page with tabbed UI

    agents/
      {suite-name}/
        page.tsx           # Public agent info page

supabase/
  migrations/
    00XXX_{description}.sql  # One migration per table, sequential numbering

scripts/
  seed-{suite-name}.ts      # Registers agent + sub-agents + capabilities
```

### Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Suite directory | kebab-case | `analyst` |
| Agent directory | kebab-case | `rosetta`, `sentinel` |
| DB tables | `{suite}_` prefix, snake_case | `analyst_sources`, `analyst_records` |
| API routes | kebab-case | `/api/analyst/validation-rules` |
| Capabilities | `{verb}.{action}` | `normalize.resolve`, `validate.run` |
| Dispatch schemas | `{verb}{Action}Schema` | `validateRunSchema` |

---

## Infrastructure Layer

### Authentication

Two auth methods, unified via `getAuthContext(request)` from `@/lib/auth`:

```typescript
import { getAuthContext, hasScope } from "@/lib/auth";

interface AuthContext {
  profileId: string;
  authMethod: "session" | "api_key";
  scopes: string[];
  supabase: SupabaseClient;
  orgId: string | null;
  orgRole: OrgRole | null;
}
```

**Frontend routes** (user-facing CRUD):
```typescript
const auth = await getAuthContext(request);
if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
if (!hasScope(auth, "agents:write")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
```

**Dispatch route** (internal, called by job system or other agents):
```typescript
// Verified via internal header + timing-safe comparison
const provided = request.headers.get("x-internal-key") ?? "";
const keyBuf = Buffer.from(INTERNAL_KEY);
const providedBuf = Buffer.from(provided);
if (keyBuf.length !== providedBuf.length || !timingSafeEqual(keyBuf, providedBuf)) { ... }

// Owner resolved from job_id:
const { data: job } = await admin.from("jobs").select("requester_profile_id").eq("id", jobId).single();
```

### Database Access

Always use the admin client for server-side operations:

```typescript
import { createAdminClient } from "@/lib/supabase/admin";
const admin = createAdminClient();
```

All tables use Row Level Security (RLS) with `owner_id` scoping:
```sql
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own {resource}" ON {table}
  FOR ALL USING (auth.uid() = owner_id);
```

### Rate Limiting

- Dispatch: IP-based via `checkDispatchRateLimit(ip)` from `@/lib/rate-limit`
- API keys: Per-key RPM via Upstash Redis sliding window
- Frontend routes: Rely on session auth (no separate rate limit needed)

### LLM Integration

When an agent capability needs an LLM:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = new Anthropic({ apiKey });

const response = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 4096,
  system: SYSTEM_PROMPT,
  messages: [{ role: "user", content: prompt }],
});

const text = response.content[0].type === "text" ? response.content[0].text : "";
const inputTokens = response.usage.input_tokens;
const outputTokens = response.usage.output_tokens;
```

Guidelines:
- Check `apiKey` exists before calling. Return 503 if not configured.
- Use LLMs for judgment tasks (entity resolution, root cause analysis) — not for things computable deterministically.
- Always track token usage for cost visibility.
- Keep system prompts focused and domain-specific. The prompt is part of the agent's intelligence.

---

## Dispatch System

The dispatch endpoint is the universal interface for agent-to-agent communication. One `POST /api/{suite}/dispatch` handles all capabilities for a suite.

### Structure

```
POST body: { capability: "verb.action", input: { ... }, job_id: "uuid" }
```

1. Rate limit by IP
2. Verify internal key (timing-safe)
3. Parse body → extract `capability`, `input`, `job_id`
4. Switch on `capability`
5. Validate input with Zod schema
6. Resolve `owner_id` from `job_id`
7. Call engine function
8. Return result

### Adding a New Capability

1. Add Zod schema at the top of `dispatch/route.ts`
2. Add `case "verb.action"` in the switch
3. Validate input, resolve owner, call engine, return result
4. Update the seed script's `capability_schema` array

### Cross-Suite Dispatch

When Agent A needs to call Agent B's capability:

1. Agent A's engine doesn't import Agent B's code
2. Instead, Agent A creates a job targeting Agent B's dispatch endpoint
3. The job system calls Agent B's dispatch with the correct internal key
4. Agent B processes and writes results to its tables
5. Agent A reads from Agent B's tables (or receives the result via the job system)

This keeps agents decoupled. Agent A doesn't need to know how Agent B works — just what capabilities it exposes and what input it expects.

---

## Engine Pattern

Engines live in `src/lib/{suite}/{agent}/engine.ts` and are pure logic — no HTTP, no auth. They receive a `SupabaseClient` and `ownerId` as parameters.

```typescript
export async function doThing(
  admin: SupabaseClient,
  ownerId: string,
  ...params
): Promise<ResultType> {
  // 1. Load data from DB
  // 2. Process (compute, call LLM, apply rules)
  // 3. Save results back to DB (enriching the data layer)
  // 4. Return structured result
}
```

Key principles:
- **Stateless**: All state comes from DB, all state goes back to DB
- **Batch-friendly**: Process arrays of records, not one at a time
- **Error propagation**: Throw errors, let the API route catch and format them
- **No HTTP concerns**: No `NextResponse`, no headers, no status codes
- **Write back to the data layer**: Engines don't just return results — they persist them. This is what makes the ecosystem work. Sentinel doesn't just tell you about validation errors; it writes flags to records so Pathfinder and Brief can see them.

---

## API Route Pattern

All frontend-facing routes follow this template:

```typescript
// GET — list resources
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("table_name")
    .select("columns")
    .eq("owner_id", auth.profileId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

// POST — create resource
export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasScope(auth, "agents:write")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json(
    { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
    { status: 400 }
  );

  const { data, error } = await admin.from("table_name").insert({ owner_id: auth.profileId, ...parsed.data }).select().single();

  if (error?.code === "23505") return NextResponse.json({ error: "Already exists" }, { status: 409 });
  if (error?.code === "23503") return NextResponse.json({ error: "Referenced resource not found" }, { status: 400 });
  if (error) return NextResponse.json({ error: "Failed to create" }, { status: 500 });

  return NextResponse.json({ item: data }, { status: 201 });
}
```

Error codes: `23505` = unique violation, `23503` = foreign key violation.

---

## Database Migration Pattern

One table per migration. Sequential numbering. Always include:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`
- RLS policy scoped to `auth.uid() = owner_id`
- Relevant indexes (foreign keys, common query patterns)

```sql
CREATE TABLE {suite}_{resource} (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- domain columns
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_{resource}_{fk} ON {suite}_{resource}({fk_column});

ALTER TABLE {suite}_{resource} ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own {resource}" ON {suite}_{resource}
  FOR ALL USING (auth.uid() = owner_id);
```

### Table Design for Agent Ecosystems

When designing tables, think about who writes and who reads:

| Table Pattern | Writer | Readers | Purpose |
|---|---|---|---|
| Config tables (rules, templates, sources) | User via CRUD | Engines at runtime | User-defined parameters |
| Data tables (records, datasets) | Import + engines | All downstream agents | The enriched data layer |
| Run tables (validation_runs, anomalies) | Engines | Dashboard + downstream agents | Operational state + audit trail |

The key insight: **data tables should accumulate context over time**. The `analyst_records` table has `entity_mappings` (written by Rosetta), `flags` (written by Sentinel), and `normalized_values` (written during import). Each agent adds to the record without overwriting what others have contributed.

---

## Template System (Brief Pattern)

For agents that produce configurable output, use the template pattern:

1. **Templates table** — stores named JSON parameter definitions per output type
2. **Params resolution** — `template_id` loads base params, inline params override
3. **Engine accepts both** — `templateId?: string, inlineParams: Params = {}`

```typescript
// Resolve: template base + inline overrides
const { params, template } = await resolveParams(admin, ownerId, templateId, inlineParams);
```

This lets users and agents:
- Save reusable configurations ("Q1 Market Share Report")
- Call with just a template_id and fresh data
- Override specific params inline without modifying the template
- **Generate templates programmatically** — another agent (or LLM) can create a template, then Brief executes it

The template pattern is applicable beyond Brief. Any agent that needs user-configurable behavior can use it: validation rule presets, investigation strategies, normalization profiles.

---

## Dashboard UI Pattern

Each suite gets a tabbed dashboard page at `src/app/dashboard/{suite}/page.tsx`.

### Structure

```
"use client"

// Types (interfaces for each resource)
// Sub-components (extracted for type safety when needed)
// Main component (single default export)
//   State (useState for each resource + forms)
//   Fetchers (useCallback, call API routes)
//   Effects (useEffect per tab, fetch on tab activate)
//   Form handlers (async, fetch POST/PATCH/DELETE, refresh after)
//   Skeleton loader
//   Style constants (inputCls, labelCls, btnPrimary, btnCancel)
//   Tab definitions
//   Render (SiteNav + main + tab bar + tab content)
```

### Style Constants

```typescript
const inputCls = "w-full px-3 py-2 bg-[#0a0a0f] border border-[#1f2028] rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-700 transition-colors";
const labelCls = "block text-xs text-gray-500 uppercase tracking-widest mb-1";
const btnPrimary = "px-4 py-2 bg-cyan-400 text-gray-950 rounded-lg hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-semibold";
const btnCancel = "text-xs text-gray-500 hover:text-gray-300 transition-colors";
```

### Badges

Use the `Badge` component from `@/components/ui/badge`:
- `variant="status" status="active|pending|failed|running|inactive"`
- `variant="tag"` for labels
- `variant="trust"` for positive states

---

## Seed Script Pattern

Registers the agent and its capabilities in the `agents` table.

```typescript
// 1. Upsert parent suite agent (listing_type: "suite", has mcp_endpoint)
// 2. Upsert each sub-agent (listing_type: "standard", parent_agent_id: suite.id, no mcp_endpoint)
//    - Each sub-agent has capability_schema: array of { name, description, inputSchema, outputSchema }
```

Key fields:
- `slug`: unique, used for upsert conflict resolution
- `mcp_endpoint`: only on the parent suite, points to dispatch route
- `capability_schema`: JSON Schema format for each capability's input/output — this is the agent's public API contract
- `agent_type`: "reactive" (responds to requests), "hybrid" (reactive + autonomous)
- `goal`: what the agent is trying to accomplish — used by orchestrators to decide which agent to call
- `decision_logic`: how the agent decides what to do — used for transparency and debugging
- `status`: "active" to make available
- `visibility`: "public" to show on marketplace

---

## Build Path — New Agent Checklist

### Phase 1: Design

1. **Define the agent's efficiency thesis** — what does it eliminate? What does it accelerate? What does it enable for other agents?
2. **Design capabilities** — what verbs/actions will this agent expose? Use `{verb}.{action}` format.
3. **Map the data flow** — what does this agent read from, and what does it write back? How does it enrich the shared data layer?
4. **Identify cross-agent touchpoints** — which existing agents' output does this agent consume? Which agents will consume this agent's output?

### Phase 2: Schema

5. **Design tables** — separate config, data, and run tables
6. **Write migrations** — one per table, sequential numbering from latest
7. **Run migrations** — `supabase db push` or apply via dashboard

### Phase 3: Engine

8. **Create engine directory** — `src/lib/{suite}/{agent}/`
9. **Write engine functions** — one exported function per capability
10. **Write helper modules** — rule executors, processors, etc. as needed
11. **Ensure engines write back** — persist results to the data layer, don't just return them

### Phase 4: API

12. **Create API route** — `src/app/api/{suite}/{resource}/route.ts` for CRUD
13. **Create action route** (if needed) — for operations beyond CRUD
14. **Wire dispatch** — add cases in `dispatch/route.ts` with Zod validation

### Phase 5: UI

15. **Add dashboard tab** — new tab type, state, fetcher, effect, form handlers, tab content
16. **Type check** — `npx tsc --noEmit` must pass clean

### Phase 6: Register

17. **Update seed script** — add sub-agent with capability_schema, goal, decision_logic
18. **Run seed** — `npx tsx scripts/seed-{suite}.ts`

### Phase 7: Verify

19. **Type check** — clean compile
20. **Manual test** — create resource via dashboard, verify API responses
21. **Test dispatch** — verify capability works through job system
22. **Test data enrichment** — verify downstream agents can read what this agent wrote

---

## Current Agent Inventory

| Agent | Slug | Capabilities | Efficiency Thesis |
|---|---|---|---|
| **Analyst Suite** | `analyst-suite` | (parent — routes to sub-agents) | Orchestrates the full data-to-insight pipeline |
| **Rosetta** | `analyst-rosetta` | normalize.map, normalize.resolve, normalize.learn | Eliminates manual entity matching; builds a learning taxonomy |
| **Sentinel** | `analyst-sentinel` | validate.run, validate.check, validate.history | Eliminates manual QA; provides trust signals to the ecosystem |
| **Pathfinder** | `analyst-pathfinder` | investigate.anomaly, investigate.explain, investigate.drill | Eliminates manual root cause investigation; surfaces anomalies with context |
| **Brief** | `analyst-brief` | compile.report, compile.slide, compile.table, compile.chart | Eliminates manual report building; template-driven, reusable output |

### Data Flow

```
Raw vendor data
  ↓
[Rosetta] normalize → entity_mappings, normalized_values written to records
  ↓
[Sentinel] validate → flags written to records, validation_summary to datasets
  ↓
[Pathfinder] investigate → anomalies written to analyst_anomalies with z-scores
  ↓
[Brief] compile → reads all enriched data, produces structured output via templates
```

Each arrow represents data enrichment, not a direct function call. The agents are decoupled — they communicate through the shared data layer.

### Database Tables

| Table | Written By | Read By | Purpose |
|---|---|---|---|
| analyst_sources | User | Rosetta, Brief | Data source configurations |
| analyst_dimensions | User | Rosetta, Pathfinder, Brief | Taxonomy dimensions |
| analyst_entities | User, Rosetta | All agents | Canonical entities |
| analyst_aliases | Rosetta, User | Rosetta | Entity name variants (learning layer) |
| analyst_validation_rules | User | Sentinel | Configurable validation rules |
| analyst_datasets | User, Sentinel | All agents | Dataset metadata + validation summary |
| analyst_records | Import, Rosetta, Sentinel | All agents | The core enriched data layer |
| analyst_validation_runs | Sentinel | Dashboard, Brief | Validation audit trail |
| analyst_anomalies | Pathfinder | Dashboard, Brief | Detected anomalies with context |
| analyst_templates | User, Agents | Brief | Reusable output templates |

### API Routes

| Route | Methods | Purpose |
|---|---|---|
| /api/analyst/dispatch | POST | Internal capability dispatch |
| /api/analyst/sources | GET, POST | Data source CRUD |
| /api/analyst/dimensions | GET, POST | Dimension CRUD |
| /api/analyst/entities | GET, POST | Entity CRUD |
| /api/analyst/aliases | GET, POST | Alias CRUD |
| /api/analyst/datasets | GET, POST | Dataset CRUD |
| /api/analyst/validation-rules | GET, POST, PATCH, DELETE | Validation rule CRUD |
| /api/analyst/validation-run | GET, POST | Run validation, get history |
| /api/analyst/investigate | GET, POST | Anomaly detection, explain, drill |
| /api/analyst/templates | GET, POST, PATCH, DELETE | Template CRUD |
| /api/analyst/compile | POST | Run Brief compilation |
