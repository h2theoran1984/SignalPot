# Auto-Rollback Guardrail v1

## What it does

The guardrail evaluates rolling health metrics for an agent and triggers a rollback decision when configured thresholds are breached. It supports two operating modes:

- `dry_run`: records incidents but does not mutate agent configuration
- `active`: applies rollback to the latest known-good snapshot

## Data model

Migration: `supabase/migrations/00066_auto_rollback_guardrail.sql`

- `agent_rollback_policies`
  - Per-agent threshold and mode controls
- `agent_config_snapshots`
  - Snapshot history of `(model_id, system_prompt, architect_version)`
  - Tracks known-good snapshots for rollback targets
- `agent_rollback_incidents`
  - Incident/audit record for simulate/manual/auto trigger attempts
  - Includes violations, policy snapshot, cooldown, and lifecycle status

## API

Route: `POST /api/agents/[slug]/rollback`

Auth:
- Admin session (`profiles.is_admin = true`) or
- Internal admin bearer (`ARENA_ADMIN_SECRET`)

Supported actions:

### `simulate`
Records a simulated incident if thresholds are breached.

```json
{
  "action": "simulate",
  "source": "ops",
  "metrics": {
    "sample_size": 25,
    "error_rate": 0.14,
    "avg_latency_ms": 4200,
    "success_rate": 0.82,
    "trust_score": 0.49
  }
}
```

### `trigger`
Evaluates and creates an incident. In `active` mode, applies rollback to the latest known-good snapshot when available.

### `acknowledge`
Marks incident as acknowledged.

```json
{ "action": "acknowledge", "incident_id": "<uuid>", "note": "Investigating" }
```

### `resolve`
Marks incident as resolved.

```json
{ "action": "resolve", "incident_id": "<uuid>", "note": "fixed" }
```

### `policy`
Upserts per-agent policy values.

```json
{
  "action": "policy",
  "mode": "dry_run",
  "enabled": true,
  "min_sample_size": 20,
  "max_error_rate": 0.08,
  "max_latency_ms": 3000,
  "min_success_rate": 0.9,
  "min_trust_score": 0.55,
  "cooldown_minutes": 30
}
```

Companion read route:
- `GET /api/agents/[slug]/rollback` returns policy + incident + snapshot state.

## Admin panel

UI: `/admin/rollback`

Capabilities:
- Select active agent
- Run simulate/trigger with metric payloads
- Update policy thresholds and mode
- Acknowledge/resolve incidents
- Inspect recent snapshots

## Environment variables

Optional defaults (used when no row exists in `agent_rollback_policies`):

- `ROLLBACK_GUARDRAIL_ENABLED` (default `true`)
- `ROLLBACK_GUARDRAIL_MODE` (`dry_run` or `active`, default `dry_run`)
- `ROLLBACK_MIN_SAMPLE_SIZE` (default `20`)
- `ROLLBACK_MAX_ERROR_RATE` (default `0.08`)
- `ROLLBACK_MAX_LATENCY_MS` (default `3000`)
- `ROLLBACK_MIN_SUCCESS_RATE` (default `0.9`)
- `ROLLBACK_MIN_TRUST_SCORE` (default `0.55`)
- `ROLLBACK_COOLDOWN_MINUTES` (default `30`)

## Rollout checklist

1. Apply migration `00066_auto_rollback_guardrail.sql`.
2. Keep `ROLLBACK_GUARDRAIL_MODE=dry_run` initially.
3. Run simulations for top agents and tune thresholds.
4. Verify incidents/snapshots are being captured.
5. Flip selected agents to `active` via policy action.

## Local validation

Decision-engine checks:

```bash
npx tsx scripts/test-rollback-guardrail.ts
```

Scoped lint:

```bash
npx eslint src/lib/arena/rollback-guardrail.ts 'src/app/api/agents/[slug]/rollback/route.ts' src/app/admin/rollback/page.tsx
```
