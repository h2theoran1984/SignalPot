# Trust Control Tower PR

## What this adds

This package introduces a reliability-first control plane across three surfaces:

- **Fleet ops:** `/admin/reliability`
- **Per-agent control API:** `/api/agents/[slug]/reliability`
- **Public proof card:** `/agents/[slug]/proof`

It also upgrades the telemetry rollup job to compute reliability snapshots and trigger automatic rollback guardrail checks.

## Schema

Migration: `supabase/migrations/00067_trust_control_tower.sql`

### `agents` additions
- `reliability_score`
- `reliability_band` (`elite | strong | watch | critical | unknown`)
- `reliability_checked_at`
- `traffic_mode` (`normal | canary | frozen`)
- `canary_percent`
- `freeze_until`

### New table
`agent_reliability_snapshots` records scored evidence points over time:
- sample size, success/error rates
- latency + trust + health components
- final reliability score + band
- component drivers for explainability

## Reliability model

`src/lib/reliability.ts`

Weighted score:
- success: 0.40
- error pressure: 0.15
- latency: 0.15
- trust: 0.20
- health: 0.10

Band thresholds:
- `elite >= 0.90`
- `strong >= 0.75`
- `watch >= 0.50`
- `critical < 0.50`

The module also emits narrative delta summaries ("why it moved").

## Telemetry integration

`src/lib/inngest/functions/telemetry-rollup.ts`

After each batch rollup:
1. updates per-agent trust and baseline stats
2. computes reliability score + drivers
3. inserts a reliability snapshot
4. updates live agent traffic state (`normal/canary/frozen`)
5. runs `processRollbackForAgent(..., triggerMode: "auto")`

## Traffic safety behavior

`src/lib/arena/rollback-guardrail.ts`

When rollback executes in active mode:
- agent is switched to `traffic_mode = frozen`
- `canary_percent = 0`
- `freeze_until = now + cooldown`

When incident is resolved:
- traffic is moved to `canary`
- `canary_percent = 20`
- freeze is cleared

## Validation commands

```bash
npx eslint src/lib/reliability.ts \
  src/lib/inngest/functions/telemetry-rollup.ts \
  src/lib/arena/rollback-guardrail.ts \
  'src/app/api/agents/[slug]/reliability/route.ts' \
  src/app/admin/reliability/page.tsx \
  'src/app/agents/[slug]/proof/page.tsx' \
  'src/app/api/agents/[slug]/rollback/route.ts' \
  scripts/test-reliability.ts scripts/test-rollback-guardrail.ts

npm run test:reliability
npm run test:rollback
```
