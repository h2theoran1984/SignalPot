# SignalPot Sprint Plan

## Status Key
- [ ] Not started
- [x] Completed

---

## Completed Work

### Enterprise Phase 1 (committed + pushed)
- [x] Sprint E1: Database schema — organizations, org_members, audit_log tables + nullable org_id columns
- [x] Sprint E2: Auth context + RBAC + org-aware RLS policies
- [x] Sprint E3: API route updates with RBAC helpers + audit logging
- [x] Sprint E4: Org management API (9 endpoints — CRUD orgs, members, audit)
- [x] Sprint E5: Org management UI (OrgSwitcher, create org, dashboard, members, settings, audit log)

### Security Hardening (committed + pushed)
- [x] Fix escrow race conditions (atomic UPDATE with status='held' WHERE clause)
- [x] Fix proxy route double-credit (idempotency key claimed before payment)
- [x] Fix wildcard CORS (origin allowlist replaces *)
- [x] Fix rate-limit fail-open (fail-closed when Redis unavailable)
- [x] Fix SECURITY DEFINER missing search_path (migration 00024)

---

## Sprint D1: Deploy & Wire Up (Ops)

**Goal:** Get enterprise + security code live on production.

1. [x] Run migration 00022_organizations.sql on Supabase
2. [x] Run migration 00023_org_rls.sql on Supabase
3. [x] Run migration 00024_security_hardening_v2.sql on Supabase
4. [x] Register Stripe webhook endpoint in Stripe Dashboard
   - URL: `https://www.signalpot.dev/api/billing/webhook`
   - Events: checkout.session.completed, customer.subscription.deleted, customer.subscription.updated
5. [x] Set STRIPE_WEBHOOK_SECRET env var in Vercel
6. [ ] Verify Vercel deployment succeeded (check build logs)
7. [ ] Smoke test: create org via /orgs/new while logged in

---

## Sprint D2: Medium Security Fixes

**Goal:** Close remaining medium-severity issues from the security audit.

1. [x] **Trust score inflation** — 1-hour cooldown per agent pair in trust trigger (migration 00025)
2. [x] **Uncapped rate_amount** — Capped at $10,000 in createAgentSchema and updateAgentSchema
3. [x] **Dispute PATCH without settlement validation** — Valid transition map (open→reviewing/resolved, resolved→appealed, etc.) + require resolution on resolve
4. [x] **Silent rate-limit bypass** — Session auth users now rate-limited at 60 rpm in proxy route
5. [x] **Session token exposure** — anonymous_session_id stripped from GET /api/jobs/[id] response

---

## Sprint D3: Buildout Tracker Form Fields ✓

**Goal:** Make the /build page interactive instead of read-only.

- [x] Form inputs for all 10 sections
- [x] localStorage persistence
- [x] Export signalpot.config.json
- [x] Config progress bar

---

## Sprint A1: Agent Optimization + Cost Tracking (completed March 10-11, 2026)

**Goal:** Level up The Next Step agent for arena performance and build persistent cost visibility.

### Agent Optimization (signalpot-agent-text-analyzer repo)
- [x] Tighten system prompts for brevity (word limits on all output fields)
- [x] Reduce max_tokens from 1024 to 512
- [x] Add cost tracking via Upstash Redis (lib/cost-tracker.ts) + /costs endpoint
- [x] Secure /costs endpoint with COSTS_SECRET env var
- [x] Fix `await trackCost()` — unawaited promises killed by Vercel serverless freeze
- [x] Raise rate from $0.001 to $0.003/call (positive margin at Haiku output pricing)
- [x] Functions return `{ data, cost }` so RPC layer can report costs
- [x] Attach `_meta.provider_cost` to every A2A response

### Platform Cost Integration (signalpot repo)
- [x] Migration 00028: Add `provider_cost` column to jobs table
- [x] Proxy route extracts `_meta.provider_cost` from agent response, stores in jobs
- [x] Arena engine extracts `_meta.provider_cost` from agent response, stores in jobs
- [x] Job type updated with `provider_cost: number | null`
- [x] Dashboard: "Agent Economics" section — revenue, API costs, margin %, per-call breakdown
- [x] Agent detail page: Owner-only "Economics" panel with per-capability breakdown
- [x] Works for ANY agent that reports `_meta.provider_cost` — generic platform feature

### Still TODO
- [ ] Update agent rate_amount in Supabase to $0.003: `UPDATE agents SET rate_amount = 0.003 WHERE slug = 'the-next-step';`
- [ ] signalpot.config.json also says rate_amount: 0.003 but DB still has 0.002

---

## Sprint D4: Register Showcase Agents

**Goal:** Get the two deployed showcase agents registered on the live marketplace.

1. [ ] Generate a SIGNALPOT_API_KEY for the user's account
2. [ ] Register text-analyzer agent (signalpot-agent-text-analyzer.vercel.app)
   - Capabilities: signalpot/text-summary@v1, signalpot/sentiment@v1
3. [ ] Register github-summarizer agent (signalpot-agent-github-summary.vercel.app)
   - Capabilities: github-summary
4. [ ] Verify both appear on www.signalpot.dev/agents
5. [ ] Run a test proxy call against each to confirm end-to-end

---

## Sprint D5: Arena ELO Grind

**Goal:** Push The Next Step agent from 1231 to 1300+ ELO for Level 2.

1. [ ] Run arena matches: The Next Step vs The Sparring Partner
2. [ ] Target capabilities where The Next Step has a strong edge (meetings, action-items, summary)
3. [ ] Monitor ELO progression — need ~5-10 wins to cross 1300
4. [ ] Verify Level 2 badge appears on agent profile

---

## Sprint D6: Enterprise Phase 2 (Future)

**Goal:** SSO, private registries, advanced analytics — the premium enterprise features.

1. [x] SSO integration (OIDC) for org login — config, login, callback routes with auto-provisioning
2. [x] Private agent registries (org-only agent visibility) — migration 00026, visibility column + RLS
3. [x] Advanced analytics dashboard (usage metrics, cost breakdown, audit exports) — migration 00027, GET /api/orgs/[slug]/analytics
4. [x] Org billing (Stripe per-seat pricing for Team/Enterprise plans) — subscribe, portal, seat sync + webhook routing
5. [x] API usage quotas per org (beyond individual rate limits) — Redis monthly counters, enforced in proxy route
6. [x] Compliance exports (SOC2-ready audit log CSV/PDF downloads) — GET /api/orgs/[slug]/audit/export + /jobs/export

---

## Notes

- Migrations 00022-00024 are applied to Supabase ✓
- Migration 00025 (trust cooldown) applied to Supabase ✓
- Stripe webhook registered + STRIPE_WEBHOOK_SECRET set in Vercel ✓
- Migrations 00026 (private agents) and 00027 (analytics views) written but NOT yet applied to Supabase
- Showcase agents are deployed to Vercel but not registered on the marketplace
- Enterprise strategy doc: signalpot/docs/enterprise-strategy.md
