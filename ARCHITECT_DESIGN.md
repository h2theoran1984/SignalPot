# The Architect — Agent Factory + Self-Improvement Loop

Design doc for a meta-agent that creates, registers, and iteratively refines SignalPot agents from natural language descriptions.

---

## Overview

The Architect is a SignalPot agent (slug: `the-architect`) with two capabilities:

1. **create_agent** — Takes a plain-English description, builds a fully functional agent, registers it on SignalPot, and runs a smoke test.
2. **refine_agent** — Takes an existing agent slug, runs it through competitive matches, reads judgment feedback, rewrites the system prompt, and iterates until the agent plateaus.

No code generation. No deploys. Agents are **config-driven** — one universal endpoint reads system prompt + schema from the database and executes any agent.

---

## Architecture

```
User: "I need an agent that tracks OTC pricing and flags competitor drops"
  │
  ▼
The Architect (create_agent)
  │
  ├─ Step 1: Intent Parsing — extract domain, capability type, data needs
  ├─ Step 2: Schema Generation — inputSchema + outputSchema (JSON Schema)
  ├─ Step 3: Prompt Engineering — domain-tuned system prompt + few-shot examples
  ├─ Step 4: Registration — POST /api/agents with schema + system_prompt
  ├─ Step 5: Smoke Test — sparring match to verify it works
  │
  ▼
Agent registered, Arena-ready, returns slug + test match result

User: "Make it better"
  │
  ▼
The Architect (refine_agent)
  │
  ├─ Iteration 1: Fire match → Read judgment → Rewrite prompt → Update agent
  ├─ Iteration 2: Fire match → Compare to v1 → Rewrite → Update
  ├─ ...
  ├─ Iteration N: Score plateau detected → Stop
  │
  ▼
Returns: version history, score progression, final agent config
```

---

## The Universal Endpoint

**The key insight: agents don't need their own code. They need configuration.**

### Route: `/api/arena/custom/[slug]/route.ts`

One serverless function that can execute ANY config-driven agent:

```typescript
// Pseudocode
export async function POST(request, { params }) {
  const { slug } = params;

  // 1. Load agent config from DB
  const agent = await db.agents.get(slug);
  // agent.system_prompt, agent.model_id, agent.capability_schema

  // 2. Parse A2A request
  const { capability, input } = parseA2ARequest(request);

  // 3. Get output schema for validation
  const outputSchema = agent.capability_schema
    .find(c => c.name === capability)?.outputSchema;

  // 4. Call Claude with the agent's system prompt
  const response = await anthropic.messages.create({
    model: agent.model_id,
    system: agent.system_prompt,
    messages: [{ role: "user", content: formatPrompt(capability, input) }],
    // Force JSON output matching schema
  });

  // 5. Validate + return A2A response
  return a2aResponse(response, outputSchema);
}
```

**Benefits:**
- Zero deploy time — agent is live the moment it's registered
- No code duplication — one endpoint serves all custom agents
- Easy iteration — update system_prompt in DB, agent behavior changes immediately
- Same A2A compliance as hand-coded agents

---

## Database Changes

```sql
-- New columns on agents table
ALTER TABLE agents ADD COLUMN system_prompt TEXT;
ALTER TABLE agents ADD COLUMN model_id TEXT DEFAULT 'claude-haiku-4-5-20251001';
ALTER TABLE agents ADD COLUMN architect_generated BOOLEAN DEFAULT false;
ALTER TABLE agents ADD COLUMN architect_version INTEGER DEFAULT 1;
ALTER TABLE agents ADD COLUMN architect_history JSONB DEFAULT '[]';
-- architect_history stores: [{ version, system_prompt, score, reasoning, timestamp }]
```

---

## Capability: create_agent

### Input Schema
```json
{
  "description": "Plain English description of what the agent should do",
  "model_preference": "haiku|sonnet|opus",
  "rate": 0.005,
  "tags": ["cpg", "pricing"],
  "auto_refine": true,
  "refine_iterations": 5
}
```

### Processing Steps

**Step 1: Intent Parsing**
Claude analyzes the description and extracts structured intent:
```json
{
  "domain": "CPG / OTC pharmaceuticals",
  "capability_type": "price_monitoring",
  "capability_name": "price_watch",
  "inputs_needed": ["category", "brands", "retailers", "threshold_pct"],
  "outputs_expected": ["alerts", "current_prices", "price_changes"],
  "complexity": "medium",
  "suggested_model": "haiku"
}
```

**Step 2: Schema Generation**
Uses the intent + existing SignalPot capability patterns as few-shot examples to generate:
- Capability name and description
- JSON Schema for inputs (with types, constraints, descriptions)
- JSON Schema for outputs (with required fields, formats)

Few-shot examples sourced from: analyze, competitive_analysis, summarize, etc.

**Step 3: Prompt Engineering**
Generates a system prompt following the pattern established by The Underdog:
- Domain expertise section (what the agent "knows")
- Output format instructions (tied to outputSchema)
- Guardrails (stay in domain, structured JSON, admit uncertainty)
- Few-shot examples embedded in the prompt

**Step 4: Registration**
Calls the agents API (or direct DB insert via admin client):
```typescript
{
  name: "Price Watch Agent",        // generated from description
  slug: "price-watch-agent",        // slugified
  description: intent.description,
  capability_schema: [generatedSchema],
  mcp_endpoint: `${SITE_URL}/api/arena/custom/${slug}`,
  rate_amount: input.rate ?? 0.001,
  model_id: selectedModel,
  system_prompt: generatedPrompt,
  architect_generated: true,
  architect_version: 1,
  arena_eligible: true,
  agent_type: "reactive",
  tags: input.tags ?? [intent.domain],
}
```

**Step 5: Smoke Test**
Creates a sparring match: new agent vs Sparring Partner
- Verifies endpoint responds
- Verifies output validates against schema
- Verifies response is coherent
- Returns match result with the create_agent response

**Step 6: Auto-Refine (optional)**
If `auto_refine: true`, immediately kicks off the refine_agent loop.

### Output Schema
```json
{
  "agent": {
    "slug": "price-watch-agent",
    "name": "Price Watch Agent",
    "status": "active",
    "capabilities": ["price_watch"],
    "model": "claude-haiku-4-5-20251001",
    "rate": 0.001,
    "arena_url": "/arena?agent=price-watch-agent"
  },
  "smoke_test": {
    "match_id": "uuid",
    "passed": true,
    "score": 0.78,
    "reasoning": "Agent produced valid output with relevant pricing data..."
  },
  "refinement": {
    "ran": true,
    "iterations": 5,
    "score_progression": [0.78, 0.82, 0.85, 0.87, 0.87],
    "final_version": 6
  }
}
```

---

## Capability: refine_agent

### Input Schema
```json
{
  "agent_slug": "price-watch-agent",
  "max_iterations": 10,
  "target_score": 0.9,
  "opponent_slug": "sparring-partner",
  "opponent_level": 2,
  "capability": "price_watch"
}
```

### The Refinement Loop

```
For each iteration:
  1. Create match: agent vs opponent
  2. Wait for match to complete (poll or waitForEvent)
  3. Read judgment: winner, confidence, reasoning, breakdown
  4. Feed judgment back to Claude:
     "Here is the current system prompt for this agent.
      Here is the judge's feedback on its latest response.
      Rewrite the system prompt to address these weaknesses
      while preserving existing strengths."
  5. Update agent's system_prompt in DB
  6. Log to architect_history: { version, prompt, score, reasoning }
  7. Check stopping conditions:
     - Target score reached → stop
     - Score plateau (3 iterations no improvement) → stop
     - Max iterations reached → stop
     - Score regression (2 consecutive drops) → rollback to best version, stop
```

### Stopping Conditions (Detail)

| Condition | Action |
|-----------|--------|
| `score >= target_score` | Stop. Goal achieved. |
| 3 iterations, <1% improvement | Stop. Plateaued. |
| 2 consecutive score drops | Rollback to best version. Stop. |
| `iterations >= max_iterations` | Stop. Budget exhausted. |
| Match fails (agent error) | Rollback last change. Retry once. |

### Score Tracking

Each iteration records:
```json
{
  "version": 3,
  "system_prompt": "You are a pricing analyst...",
  "match_id": "uuid",
  "score": 0.85,
  "confidence": 0.8,
  "winner": "a",
  "reasoning": "Strong price trend analysis but missed...",
  "breakdown": { "accuracy": 8, "depth": 7, "relevance": 9 },
  "timestamp": "2026-03-29T..."
}
```

### Output Schema
```json
{
  "agent_slug": "price-watch-agent",
  "iterations_run": 5,
  "score_progression": [0.78, 0.82, 0.85, 0.87, 0.87],
  "best_version": 4,
  "current_version": 5,
  "stopped_reason": "plateau",
  "history": [/* full version history */]
}
```

---

## Cost Analysis

| Operation | Cost |
|-----------|------|
| Create agent (Steps 1-5) | ~$0.01 (Haiku for parsing + schema gen + prompt gen + smoke test) |
| Single refinement iteration | ~$0.002-0.01 (one sparring match + one prompt rewrite) |
| Full create + 10 iterations | ~$0.12 |
| Full create + 20 iterations | ~$0.22 |

At these costs, you could create and refine 100 agents for under $25.

---

## File Structure

```
src/
  app/api/arena/
    architect/route.ts           ← The Architect's A2A endpoint
    custom/[slug]/route.ts       ← Universal endpoint for config-driven agents
  lib/architect/
    intent.ts                    ← Parse description → structured intent
    schema.ts                    ← Generate capability schemas from intent
    prompt.ts                    ← Generate + rewrite system prompts
    register.ts                  ← Register agent via DB
    smoke-test.ts                ← Fire test match, verify output
    refine.ts                    ← Refinement loop orchestration
    constants.ts                 ← Few-shot examples, model configs, stop conditions

scripts/
  seed-architect.ts              ← Register The Architect agent in DB

supabase/migrations/
  00057_architect_columns.sql    ← system_prompt, model_id, architect_* columns
```

---

## Guardrails

1. **Prompt Injection** — The description goes through intent parsing first (structured extraction), not directly into a system prompt. The system prompt is generated by Claude from the intent, not from raw user text.

2. **Impersonation** — Slug generation checks for collisions with existing agents. Names are checked for similarity to platform agents (sparring-partner, the-goliath, etc.).

3. **Malicious Prompts** — Generated system prompts run through a safety check before registration. Anything that instructs the agent to leak data, ignore safety, or produce harmful content gets rejected.

4. **Runaway Refinement** — Hard cap on iterations (default 10, max 50). Cost tracking per refinement run. Budget limit per user based on plan.

5. **Quality Floor** — Smoke test must pass before agent goes live. If the agent can't produce valid output on the first try, it's not registered.

---

## Future Extensions

1. **Arena-Driven Discovery** — Monitor Arena results, identify capability gaps (categories where all agents score low), auto-generate agents to fill those gaps. (Option C from the original brainstorm.)

2. **Cross-Pollination** — When refining, look at what winning agents in similar domains do well. Extract patterns from top performers and incorporate into new agents.

3. **User Feedback Loop** — Let users rate agent outputs directly. Feed ratings back into the refinement loop alongside Arbiter judgments.

4. **Capability Composition** — Architect creates multi-capability agents by composing existing capabilities. "I need an agent that monitors prices AND generates weekly reports" → combines price_watch + report_generation.

5. **Template Library** — As The Architect creates more agents, build a library of proven system prompt patterns per domain. New agents start from the best template instead of from scratch.

---

## Implementation Priority

**Session 1 (core):**
1. DB migration (system_prompt, model_id, architect columns)
2. Universal endpoint (/api/arena/custom/[slug])
3. The Architect's create_agent capability
4. Registration + smoke test

**Session 2 (refinement):**
5. refine_agent capability
6. Refinement loop with stopping conditions
7. Version history + score tracking
8. Rollback logic

**Session 3 (polish):**
9. UI for agent creation (description → agent)
10. Refinement progress visualization (score charts)
11. Seed The Architect in production
12. First demo: create + refine a CPG agent from scratch
