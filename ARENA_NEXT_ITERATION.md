# Arena Next Iteration — Async Agent Execution

Working design for removing the Vercel timeout dependency from Arena match execution.

---

## Status: IMPLEMENTED (2026-03-28)

All phases completed and deployed. See commit `d6b218a`.

---

## Architecture (Current — Post-Rewrite)

```
POST /api/arena/matches → creates match (pending) → fires Inngest event

Inngest: arenaExecuteMatch
  → Step 1: setup (load match, agents, resolve template, mark running)
  → Step 2: fire-agent-a (POST to agent with callback_url, returns immediately)
  → Step 3: fire-agent-b (POST to agent with callback_url, returns immediately)
  → Step 4: waitForEvent("agent-a-responded", timeout: 15m)
  → Step 5: waitForEvent("agent-b-responded", timeout: 15m)
  → Step 6: finalize (save results, billing, status transitions)
  → Step 7: trigger judging event (if both succeeded)
```

**No Vercel timeout dependency.** Agents can take up to 15 minutes. The waitForEvent pattern
wakes up the Inngest function when the callback endpoint receives the result.

### Callback Flow
```
Agent completes → POSTs to /api/arena/matches/[id]/callback?side=a|b
  → Callback fires Inngest event: arena/agent.responded
  → waitForEvent wakes up → match continues
```

---

## A2A Protocol Compliance (~85%)

### Implemented
- **Push Notifications**: tasks/pushNotificationConfig set/get/list/delete + webhook dispatch
- **Agent Card**: protocolVersion 0.2.5, securitySchemes (apiKey + bearer), security bindings, iconUrl
- **Streaming**: message/stream as proper method, tasks/resubscribe, TaskArtifactUpdateEvent, SSE event IDs
- **Task Lifecycle**: contextId session grouping, graceful cancel (canceled != failed), clean message history
- **Auth Framework**: Public methods (tasks/get), auth-required methods with scheme hints, X-API-Key support
- **Error Codes**: All 12 A2A error codes including -32007 to -32009

### Not Implemented (enterprise-specific, add per customer)
- mTLS authentication scheme
- OpenID Connect
- OAuth2 flows (authorization code, device code)
- agent/authenticatedExtendedCard (returns -32007, no private skills yet)
- Supabase Realtime subscriptions for streaming (polling is pragmatic in serverless)

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/inngest/functions/arena-execute-match.ts` | Async match orchestration (fire + waitForEvent) |
| `src/lib/arena/engine.ts` | Agent calling, fire-and-forget, push notification dispatch |
| `src/lib/a2a/handler.ts` | A2A JSON-RPC dispatcher (10 methods) |
| `src/lib/a2a/types.ts` | Full A2A type system |
| `src/app/api/agents/[slug]/a2a/rpc/route.ts` | A2A RPC endpoint (auth-aware) |
| `src/app/api/agents/[slug]/a2a/rpc/stream/route.ts` | SSE streaming (message/stream, tasks/resubscribe) |
| `src/app/api/arena/matches/[id]/callback/route.ts` | Callback endpoint (fires Inngest event) |
| `src/app/.well-known/agent.json/route.ts` | Platform-level Agent Card |
| `supabase/migrations/00056_a2a_push_notifications.sql` | Push config table, canceled status, context_id |

---

## Testing

### Verified (2026-03-28)
- ✅ DB: Push notification config CRUD
- ✅ DB: canceled job status
- ✅ DB: context_id on jobs
- ✅ API: Agent Card with protocolVersion, pushNotifications, securitySchemes
- ✅ API: Public method access (tasks/get without auth)
- ✅ API: Auth-required method rejection with scheme hints
- ✅ TypeScript: Clean compilation
- ✅ Lint: 0 errors

### Pending (needs local Inngest dev server)
- ⬜ Full async match flow: fire → waitForEvent → callback → finalize
- ⬜ 15-minute timeout behavior
- ⬜ Push notification webhook delivery

### To test locally
```bash
# Terminal 1
npm run dev

# Terminal 2
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest

# Then in Inngest dashboard (http://localhost:8288):
# 1. Send event: arena/match.created with data: {"match_id":"<pending-match-id>"}
# 2. Watch fire-agent-a/b complete, wait-agent-a/b hang
# 3. Send event: arena/agent.responded to simulate completion
```

---

## Next: The Architect (Agent Factory)

Design doc: `ARCHITECT_DESIGN.md`

A meta-agent that creates and iteratively refines agents from natural language descriptions.
Two capabilities: `create_agent` (build from scratch) and `refine_agent` (improvement loop).

Key insight: **config-driven agents** — one universal endpoint (`/api/arena/custom/[slug]`)
reads system_prompt + schema from DB and executes any agent. No code generation, no deploys.

The refinement loop uses Arena matches as a fitness function:
fire match → read judgment → rewrite prompt → repeat until plateau.

---

## Legacy

The sync endpoint (`POST /api/arena/fight`) is preserved for dev/testing.
It still calls agents synchronously with a 55s timeout — useful for quick tests
where you don't need the full async pipeline.
