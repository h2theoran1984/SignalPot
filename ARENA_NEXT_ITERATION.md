# Arena Next Iteration — Async Agent Execution

Working design for removing the Vercel timeout dependency from Arena match execution. This is the pickup point for the next session.

---

## The Problem

Arena matches call two agents and wait for responses. Both agents run LLM inference that can take 10-60+ seconds. Currently, each agent call happens inside a Vercel serverless function (via Inngest steps), which has a hard 60s limit on Pro (300s with maxDuration, but that costs more and is still a ceiling).

As prompts get harder and schemas get richer, agent response times will increase. The architecture shouldn't care how long an agent takes.

---

## Current Architecture (What Works Today)

```
Inngest event: arena/match.created
  → Step 1: setup (load match, resolve template, mark running)
  → Step 2: call Agent A (own Vercel invocation, up to 300s with maxDuration)
  → Step 3: call Agent B (own Vercel invocation, up to 300s with maxDuration)
  → Step 4: finalize (save results, billing)
  → Step 5: trigger judging event
```

Each agent call is a separate Inngest step, so they don't share timeout budget. But each step still runs inside a Vercel function that has a wall-clock limit.

**Limitation**: Agents must respond within Vercel's maxDuration (currently 300s). Fire-and-forget doesn't work in serverless — background promises get killed when the function returns.

---

## Proposed Architecture: Webhook Callbacks via External Worker

### Core Idea

Move the "wait for agent response" out of Vercel entirely. Use a lightweight external process that can wait indefinitely.

### Option A: Inngest-Native with Background Functions

Inngest supports "background" function execution that isn't tied to Vercel's timeout. Instead of running the agent call inside a Vercel step.run(), use Inngest's invoke pattern:

```
Step 1: setup
Step 2: fire Agent A request (via Inngest child function — runs on Inngest's infra)
Step 3: fire Agent B request (same)
Step 4: waitForEvent("agent-a-responded", timeout: "30m")
Step 5: waitForEvent("agent-b-responded", timeout: "30m")
Step 6: finalize
```

The child functions run on Inngest's infrastructure (not Vercel), which has longer timeouts. When each agent responds, the child function fires an event, and the parent wakes up.

**Pros**: No new infrastructure. Inngest handles the orchestration.
**Cons**: Requires Inngest Pro for long-running functions. Need to check if Inngest's own compute supports arbitrary HTTP calls.

### Option B: Dedicated Worker (Fly.io / Railway / AWS Lambda with longer timeout)

Deploy a small worker service that:
1. Receives "call this agent" requests via a queue (SQS, Redis, or Inngest event)
2. Makes the HTTP call to the agent endpoint (no timeout pressure)
3. When the agent responds, POSTs the result to the callback URL
4. The callback endpoint (on Vercel) fires the Inngest event to resume

```
Vercel (Inngest step) → sends message to queue → returns immediately
Worker (Fly.io) → picks up message → calls agent → waits however long → POSTs to callback
Vercel (callback endpoint) → receives result → fires Inngest event
Inngest → wakes up → continues to finalize/judge
```

**Pros**: True async. No timeout. Worker can be a $5/mo Fly.io machine.
**Cons**: New infrastructure to manage. Another deployment target.

### Option C: Agent-Side Webhooks (A2A Task Model)

Instead of calling agents synchronously, adopt the A2A protocol's task model:

1. Arena creates a "task" — POSTs to agent's endpoint with a task_id and callback_url
2. Agent immediately returns `{ "status": "accepted", "task_id": "..." }`
3. Agent processes asynchronously on its own infrastructure
4. When done, agent POSTs result to the callback_url
5. Arena receives the callback and continues

```
Arena → POST /agent/tasks { task_id, callback_url, prompt }
Agent → 202 Accepted (immediate)
...agent thinks...
Agent → POST /arena/callback { task_id, result }
Arena → continues
```

**Pros**: Standard A2A pattern. Agents control their own compute. Scales to any complexity.
**Cons**: Requires all agents to implement async task model. Breaking change for existing agent endpoints. Need to handle agents that never call back (timeouts).

---

## Recommended Path: Option A First, Then Option C

### Phase 1: Inngest-native (next session)

- Check if Inngest's `step.invoke()` or child function pattern supports longer execution
- If yes, move agent calls to Inngest child functions
- Parent function uses `step.waitForEvent()` (already implemented, already has the callback endpoint + event types)
- No new infrastructure

### Phase 2: A2A Task Model (future)

- Define the async task interface for agents
- Update The Underdog and The Goliath to support `202 Accepted` + callback
- Update the Arena engine to use the task model for new agents
- Keep backward compatibility for sync agents (wrap them in a worker)

---

## Already Built (Reusable)

These pieces from the current session are ready to use:

1. **Callback endpoint**: `POST /api/arena/matches/[id]/callback?side=a|b&job_id=xxx` — receives agent results, fires Inngest event
2. **Event type**: `arena/agent.responded` — defined in Inngest client with match_id, side, response, duration, cost, error
3. **waitForEvent pattern**: The Inngest function already has the structure for waiting on callback events (was tested, works conceptually, just needs the agent-side to fire the callback)

---

## Key Decisions for Next Session

1. Does Inngest Pro support long-running child functions? If yes, Option A is the path.
2. If not, is a $5/mo Fly.io worker acceptable? If yes, Option B.
3. Should agents be required to support async tasks? If yes, start migrating to Option C.
4. What's the maximum reasonable wait time for an agent? 5 min? 30 min? This determines timeout configs.

---

## Testing Plan

Once async execution is in place:
1. Run The Underdog vs The Goliath with the competitive analysis schema
2. Verify both agents complete without timeout pressure
3. Compare response quality when Opus has unlimited time
4. Run 5 matches on different category scenarios (Pain Relief, Digestive, Allergy, Cold/Flu, Vitamins)
5. Analyze: does domain knowledge still win when Opus is truly unconstrained?
