# SignalPot Enterprise — Strategy & Architecture Document

> **Date:** March 9, 2026
> **Version:** 1.0
> **Author:** SignalPot Engineering

---

## 1. Executive Summary

SignalPot is an AI Agent Economic Corridor — a marketplace where AI agents are discovered, registered, tested, and transacted upon with trust built on real job completions. Today it serves individual developers and small teams with a consumer SaaS model (Free/$9/$49 tiers).

**SignalPot Enterprise** extends this into a platform that organizations deploy internally or subscribe to as a managed service. The unique value proposition is the combination of three capabilities that no competitor offers together: an **Agent Marketplace** (discovery and registration), an **Arena** (competitive head-to-head testing with ELO ratings), and a **Trust Graph** (reputation derived from real job completions, not self-reported reviews). This trifecta creates a flywheel — agents are registered, tested in the arena to prove capability, and accumulate trust through real usage — that enterprise buyers need to evaluate and procure AI agents with confidence.

The enterprise AI agent platform market is nascent but growing rapidly. Current players (CrewAI, LangChain, Relevance AI, Vellum, Humanloop) focus primarily on orchestration and observability. None offer a marketplace + arena + trust graph combination. This gap represents a significant first-mover opportunity for SignalPot to own the "agent procurement and quality assurance" category in enterprise.

---

## 2. Competitive Landscape

### 2.1 Competitor Summary

| Platform | Focus | Pricing | Enterprise Features | What They're Missing |
|----------|-------|---------|--------------------|--------------------|
| **CrewAI** | Agent orchestration & deployment | Free / $25 Pro / Custom Enterprise | K8s+VPC self-hosting, SOC2, SSO, PII masking, FedRAMP High | No marketplace, no agent discovery, no competitive testing |
| **LangSmith** | Observability & evaluation | Free / $39/seat Plus / Custom Enterprise | Hybrid/self-hosted, SSO+RBAC, deployed eng team, SLAs | No marketplace, no trust system, no arena |
| **Relevance AI** | AI workforce automation | Free / $234/mo Team / Custom Enterprise | Multi-org, SSO SAML, RBAC, audit logs, SOC2+GDPR | No agent marketplace, no open registry, no competitive testing |
| **Humanloop** | LLM evals & prompt management | Free trial / Custom Enterprise | SOC2 Type II, SSO+SAML, RBAC, VPC, HIPAA, GDPR | No agent marketplace, no trust graph, eval-focused only |
| **Hugging Face** | Model/dataset hub | $9 Pro / $20/seat Team / $50+/seat Enterprise | SSO+SAML, audit logs, storage regions, resource groups | Model-centric not agent-centric, no arena, no trust graph |
| **Vellum AI** | Workflow orchestration | Free / $25 Pro / $50 Business / Custom Enterprise | RBAC, SSO, VPC+on-prem, DPA+BAA | No marketplace, no agent discovery, workflow-focused |

### 2.2 Key Insight

Every competitor is building **tools for building agents** (orchestration, observability, evaluation). None are building **infrastructure for discovering, trading, and trusting agents**. SignalPot occupies a unique category:

- **CrewAI** helps you build agent crews. SignalPot helps you find and vet the agents to put in those crews.
- **LangSmith** helps you debug agent traces. SignalPot helps you prove your agent is better than the competition.
- **Hugging Face** hosts models. SignalPot hosts live, callable agents with economic transactions.

### 2.3 Gap Analysis

What enterprise buyers want that nobody offers:

1. **Agent procurement confidence** — "How do I know this agent is any good?" (Arena solves this)
2. **Trust without self-reporting** — "Every agent claims 99% accuracy" (Trust Graph solves this)
3. **Private agent registries** — "I need internal agents only visible to my org" (Enterprise feature)
4. **Internal benchmarking** — "I want to test our agents against each other before deploying" (Org-scoped Arena)
5. **Agent marketplace with SLAs** — "I need uptime guarantees on agents I depend on" (Enterprise tier)

---

## 3. Product Vision

### 3.1 Deployment Models

| Model | Description | Target Customer |
|-------|-------------|----------------|
| **Cloud** | Multi-tenant SaaS at signalpot.dev | Startups, SMBs, individual developers |
| **Hybrid** | SaaS control plane + customer's data plane | Mid-market, data-sensitive industries |
| **Self-Hosted** | Full on-premises via Docker/K8s | Regulated industries (finance, healthcare, government) |

### 3.2 Core Enterprise Features

**Private Agent Registries**
Organizations get their own namespace (e.g., `acme.signalpot.dev/agents/`) where internal agents are registered, discovered, and managed. Private agents are invisible to the public marketplace but participate in org-scoped arenas and trust graphs.

**Org-Scoped Arenas**
Internal competitions where teams benchmark agents against each other before production deployment. Custom rubrics reflecting org-specific quality criteria. Tournament brackets for quarterly agent evaluations.

**Team-Scoped Trust Graphs**
Reputation data isolated within organizational boundaries. Trust edges reflect internal job completions, not global data. Optional: publish trust scores externally for agents offered on the public marketplace.

**SSO/SAML**
Support for Okta, Azure AD, OneLogin, and generic SAML 2.0/OIDC providers. Enterprise customers can enforce SSO-only authentication.

**Role-Based Access Control (RBAC)**

| Role | Permissions |
|------|------------|
| **Owner** | Full admin: billing, members, settings, delete org |
| **Admin** | Manage members, approve agents, configure arenas |
| **Developer** | Create/edit agents, run arena matches, view trust graph |
| **Viewer** | Read-only access to agents, matches, trust scores |
| **Auditor** | Read-only + full audit log access, compliance reports |

**Audit Logging**
Every API call, agent action, arena match, and billing event logged to an append-only audit table. Exportable to SIEM tools (Splunk, Datadog, etc.). Configurable retention (90 days to 7 years).

**Agent Approval Workflows**
Agents go through a lifecycle: Draft > Pending Review > Approved > Active. Org admins can require review before agents are visible to the org or published externally.

**Data Residency**
Database region selection (US, EU, APAC). For self-hosted: data never leaves the customer's infrastructure.

---

## 4. Architecture — Current State Assessment

### 4.1 Enterprise Readiness Scorecard

| Area | Current State | Enterprise Ready | Critical Gaps | Effort |
|------|--------------|-----------------|---------------|--------|
| **Authentication** | Session + API keys, basic scopes | 40% | No SSO, no team scoping, no RBAC | 4-6 weeks |
| **Database** | Single-tenant, user-centric | 20% | No org structure, no workspace isolation | 8-12 weeks |
| **API Layer** | 35+ routes, Zod validation | 50% | No audit logging, no org RBAC, no versioning | 4-8 weeks |
| **Billing** | 3-tier plans, Stripe, credit wallet | 30% | No org billing, no metering, no contracts | 10-16 weeks |
| **Arena** | Global matches, ELO, voting | 50% | No org-scoped competitions, no tournaments | 6-10 weeks |
| **Trust Graph** | Materialized edges, 3D viz | 60% | No private edges, no org scoping | 2-4 weeks |
| **Agent Registry** | Global discovery, A2A protocol | 40% | No private registries, no approval workflow | 5-8 weeks |
| **Infrastructure** | Vercel + Supabase + Inngest | 15% | Not self-hostable, vendor lock-in | 16-24 weeks |
| **Security** | RLS, SSRF protection, CSP, escrow | 60% | No field encryption, limited audit | 4-6 weeks |

**Overall: 35-40% Enterprise Ready**

### 4.2 What's Reusable As-Is

- **Authentication foundation** (src/lib/auth.ts) — dual session + API key model is solid; needs expansion not replacement
- **API key management** (src/lib/api-keys.ts) — SHA-256 hashing, scopes, expiration all enterprise-grade
- **Financial integrity** — escrow, disputes, atomic settle_job_payment() RPC, platform fee splitting
- **Arena engine** — ELO, rubric-based judging, multi-level system, sparring partner
- **Trust Graph algorithm** — weighted trust scoring formula is production-ready
- **A2A protocol** — JSON-RPC 2.0 with streaming, error codes, agent cards (70% ready)
- **Zod validation** — all API inputs validated; no schema changes needed
- **Code quality** — TypeScript throughout, clean architecture, no tech debt

### 4.3 What Needs the Most Work

1. **Multi-tenancy (Critical)** — Zero org/team concept exists. Every table needs `org_id` foreign key. ~20 migrations + 30+ RLS policies need refactoring.
2. **Org billing (Critical)** — Per-user plans only. No team seats, org subscriptions, annual contracts, or usage metering.
3. **SSO/RBAC (High)** — Only GitHub OAuth + basic `is_admin` flag. Need full role hierarchy per org.
4. **Self-hosting (Optional)** — Entirely cloud-dependent. Containerization requires abstracting Supabase, Inngest, and Upstash.

---

## 5. Pricing Strategy

### 5.1 Recommended Tier Structure

Based on competitive analysis across 6 platforms:

| Tier | Price | Target | Key Features |
|------|-------|--------|-------------|
| **Free** | $0 | Individual developers | 1,000 agent calls/mo, 3 agents, public arena, community support |
| **Pro** | $29/mo | Power users | 25,000 calls/mo, unlimited agents, priority routing, email support |
| **Team** | $99/mo + $15/seat | Small teams (5-20) | 100,000 calls/mo, 10 seats included, SSO, org-scoped arena, audit logs |
| **Enterprise** | Custom ($25K+ ACV) | Large organizations | Unlimited calls, custom SLAs, dedicated support, self-hosted option, RBAC, compliance |

### 5.2 Platform Fees

| Fee Type | Rate | Justification |
|----------|------|---------------|
| **Marketplace cut** | 10% (current) | Competitive with AWS Marketplace (3-5%), well below app stores (30%). Keep at 10% to attract sellers; can increase to 12-15% once marketplace has liquidity |
| **Enterprise marketplace** | 8% | Volume discount for enterprise customers running high transaction volume |
| **Promoted listings** | $99-$299/mo | Optional featured placement in search results and marketplace homepage |

### 5.3 Annual Contract Structure

- **Pro annual:** $23/mo (20% discount) = $276/year
- **Team annual:** $79/mo + $12/seat (20% discount)
- **Enterprise:** Minimum $25K ACV, annual or multi-year
  - $50K+/year: 15% usage discount
  - $100K+/year: 25% usage discount + dedicated account manager
  - $250K+/year: 30% discount + forward-deployed engineer

### 5.4 Pricing Rationale

The hybrid model (platform subscription + usage + marketplace fee) mirrors the most successful patterns in the market:

- **LangSmith:** $39/seat + per-trace overage
- **Datadog:** Per-host + per-feature usage (drives 130% net revenue retention)
- **Vercel:** Per-seat + usage-based bandwidth/functions
- **Supabase:** Base plan + usage-based compute/storage

The per-seat component provides predictable revenue. The usage component captures value as customers scale. The marketplace fee aligns platform revenue with ecosystem success.

---

## 6. Security & Compliance Roadmap

### Phase 1: Foundation (Months 1-3)
- **SOC 2 Type II preparation** — Engage auditor, implement required controls
- **Audit logging** — Append-only event table, all API calls logged
- **Data retention policies** — Configurable per org, GDPR right-to-delete
- **Security documentation** — Threat model, architecture diagrams, runbooks

### Phase 2: Access Control (Months 3-5)
- **SSO/SAML** — Okta, Azure AD, OneLogin, generic OIDC
- **RBAC** — Owner/Admin/Developer/Viewer/Auditor roles per org
- **MFA** — TOTP support via Supabase Auth
- **Service accounts** — Bot/CI principals separate from human users

### Phase 3: Data Protection (Months 5-7)
- **GDPR compliance** — Data export, right-to-delete, consent management, DPA template
- **Field-level encryption** — Agent auth_config, API key metadata
- **Data residency** — US and EU region options
- **Secrets rotation** — Automatic API key rotation with grace period

### Phase 4: Vertical Compliance (Months 8-12)
- **HIPAA** — BAA template, PHI handling procedures, encryption requirements (healthcare vertical)
- **FedRAMP** — Government deployment authorization (government vertical, long-term)
- **ISO 27001** — Information security management certification
- **Penetration testing** — Annual third-party security assessment

### Agent Sandboxing Model
- Agents execute in isolated environments (no access to other agents' data)
- Org admins define permitted capabilities (e.g., "no external API calls")
- Arena matches run in sandboxed evaluation contexts
- All agent-to-agent communication logged and auditable

---

## 7. Go-to-Market Strategy

### 7.1 Target Verticals

| Vertical | Why | Use Case | Timeline |
|----------|-----|----------|----------|
| **Fintech** | High-value transactions, need trust | Agent-powered trading, compliance, fraud detection | Year 1 |
| **Enterprise IT** | Internal tooling teams building agents | Private registry for internal AI tools, benchmarking | Year 1 |
| **Healthcare** | Regulatory requirements drive enterprise sales | Clinical decision support agents, HIPAA compliance | Year 2 |
| **Government** | Long sales cycles but high ACV | Citizen services automation, FedRAMP | Year 2-3 |

### 7.2 Sales Motion

**Stage 1: Product-Led Growth (Current)**
- Free tier drives developer adoption
- SDKs (Python, Node) and CLI lower barrier to entry
- Public arena creates viral competitive content ("My agent beat yours")
- Target: Individual developers and small teams

**Stage 2: Team-Led Expansion (Months 3-6)**
- Team tier with org features drives bottom-up enterprise adoption
- Developer champions within companies push for team adoption
- Self-serve purchasing up to Team tier
- Target: Engineering teams of 5-20

**Stage 3: Enterprise Sales (Months 6-12)**
- Dedicated sales team for $25K+ ACV deals
- Solution engineering for custom deployments
- Channel partnerships with SIs (Accenture, Deloitte, etc.)
- Target: Organizations with 50+ developers building AI agents

### 7.3 Developer Advocacy

- Open-source the SignalPot SDKs (Python, Node) and CLI tool (already done)
- Create "Agent of the Month" showcase program
- Publish arena leaderboards as industry benchmarks
- Host "Agent Games" — quarterly public tournaments with prizes
- Content marketing: "How Company X improved agent quality 40% with arena testing"

### 7.4 Partnership Opportunities

| Partner Type | Examples | Value Exchange |
|-------------|----------|---------------|
| **Cloud Providers** | AWS Marketplace, Azure Marketplace | Distribution + committed spend burn-down |
| **LLM Providers** | Anthropic, OpenAI, Google | Co-marketing, model integration |
| **SI Firms** | Accenture, Deloitte, McKinsey | Implementation services, enterprise deals |
| **Orchestration Tools** | CrewAI, LangChain, AutoGen | "Register your agents on SignalPot" integration |

---

## 8. Technical Roadmap

### Phase 1: Multi-Tenancy + Access Control (Months 1-3)

**Goal:** Enable organizations to use SignalPot as a team.

| Task | Files | Effort |
|------|-------|--------|
| Create `organizations` and `org_members` tables | supabase/migrations/00022_orgs.sql | 1 week |
| Add `org_id` to agents, jobs, arena_matches, api_keys | supabase/migrations/00023_org_fks.sql | 2 weeks |
| Refactor all RLS policies for org scoping | supabase/migrations/00024_org_rls.sql | 3 weeks |
| Add org context to `getAuthContext()` | src/lib/auth.ts | 1 week |
| Implement RBAC (roles table, permission checks) | src/lib/rbac.ts (new) | 2 weeks |
| SSO/SAML integration | src/lib/sso.ts (new), auth config | 2 weeks |
| Org management UI (invite, roles, settings) | src/app/org/ (new) | 2 weeks |
| Audit logging middleware | src/middleware.ts, src/lib/audit.ts (new) | 1 week |

**Milestone:** Teams can create orgs, invite members, assign roles, and see org-scoped data.

### Phase 2: Org Billing + Usage Metering (Months 4-6)

**Goal:** Enterprise customers can subscribe at the org level with usage-based billing.

| Task | Files | Effort |
|------|-------|--------|
| Org-level Stripe customers and subscriptions | src/lib/stripe.ts, src/app/api/billing/ | 2 weeks |
| Usage metering API (track calls per org) | src/lib/metering.ts (new) | 3 weeks |
| Invoice generation and billing dashboard | src/app/org/billing/ (new) | 2 weeks |
| Annual contract support | src/lib/plans.ts | 1 week |
| Spending limits and budget alerts | src/app/org/settings/ (new) | 1 week |
| Seat management (add/remove, proration) | src/app/api/billing/seats/ (new) | 2 weeks |

**Milestone:** Orgs can subscribe to Team/Enterprise plans, manage seats, and see usage reports.

### Phase 3: Private Registries + Org Arena (Months 7-9)

**Goal:** Organizations get private agent ecosystems.

| Task | Files | Effort |
|------|-------|--------|
| Agent visibility (public/org-private/unlisted) | src/app/api/agents/route.ts, schema | 2 weeks |
| Agent approval workflow (draft/pending/approved) | src/lib/agent-lifecycle.ts (new) | 2 weeks |
| Org-scoped arena matches | src/lib/arena/, src/app/api/arena/ | 2 weeks |
| Custom rubrics per org | src/lib/arena/rubric.ts | 1 week |
| Tournament brackets | src/lib/arena/tournaments.ts (new) | 3 weeks |
| Org-scoped trust graph | src/app/api/trust/ | 1 week |
| Private trust edges | supabase/migrations/ | 1 week |

**Milestone:** Orgs run private arenas with custom rubrics and maintain internal trust graphs.

### Phase 4: Compliance + Self-Hosting (Months 10-12)

**Goal:** Meet enterprise compliance requirements and offer self-hosted option.

| Task | Files | Effort |
|------|-------|--------|
| SOC 2 Type II certification | Documentation, controls | Ongoing |
| GDPR compliance (export, delete, DPA) | src/lib/gdpr.ts (new) | 2 weeks |
| Field-level encryption for sensitive data | src/lib/encryption.ts (new) | 2 weeks |
| Dockerfile + docker-compose | Root directory | 2 weeks |
| Kubernetes Helm charts | kubernetes/ (new) | 3 weeks |
| Abstract Supabase to standard PostgreSQL | src/lib/db/ (new) | 4 weeks |
| Self-hosted auth (replace Supabase Auth) | src/lib/auth/ (expand) | 3 weeks |
| Data residency configuration | Environment-based config | 1 week |

**Milestone:** Enterprise customers can deploy SignalPot on their own infrastructure.

---

## 9. Revenue Projections

### Assumptions

- Current: 0 paying customers (pre-revenue, developer tools live)
- Market: Enterprise AI platform spend growing 40-60% YoY
- Average Team tier: $99/mo + 5 seats x $15 = $174/mo ($2,088/year)
- Average Enterprise ACV: $50,000/year
- Marketplace GMV: 10% take rate

### Year 1 Projections

| Scenario | Free Users | Pro | Team | Enterprise | ARR |
|----------|-----------|-----|------|------------|-----|
| **Conservative** | 500 | 20 | 5 | 0 | $17,400 |
| **Moderate** | 2,000 | 80 | 25 | 2 | $162,000 |
| **Aggressive** | 5,000 | 200 | 60 | 5 | $445,000 |

### Year 2 Projections (Enterprise launch)

| Scenario | Free Users | Pro | Team | Enterprise | ARR |
|----------|-----------|-----|------|------------|-----|
| **Conservative** | 2,000 | 60 | 20 | 3 | $221,000 |
| **Moderate** | 8,000 | 300 | 100 | 10 | $1,013,000 |
| **Aggressive** | 20,000 | 800 | 250 | 25 | $2,620,000 |

### Year 3 Projections (Marketplace flywheel)

| Scenario | Free Users | Pro | Team | Enterprise | Marketplace GMV | ARR |
|----------|-----------|-----|------|------------|----------------|-----|
| **Conservative** | 5,000 | 150 | 60 | 8 | $500K | $627,000 |
| **Moderate** | 25,000 | 1,000 | 400 | 30 | $5M | $3,480,000 |
| **Aggressive** | 75,000 | 3,000 | 1,000 | 75 | $25M | $10,840,000 |

### Key Metrics Targets

| Metric | Year 1 | Year 2 | Year 3 |
|--------|--------|--------|--------|
| **Net Revenue Retention** | 110% | 125% | 140% |
| **Gross Margin** | 75% | 78% | 82% |
| **Free-to-Paid Conversion** | 3% | 5% | 7% |
| **Monthly Churn** | 8% | 5% | 3% |
| **Marketplace GMV** | $50K | $2M | $15M |

---

## 10. Risks and Mitigations

### Technical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Multi-tenancy migration breaks existing data | High | Medium | Feature-flag rollout, shadow migration testing, backup before migration |
| Self-hosted deployment complexity | Medium | High | Start with Docker-only, add K8s later. Don't abstract Supabase until customer demands it |
| Arena scalability at 1000+ concurrent matches | Medium | Low | Inngest handles async well; add dedicated queue workers if needed |

### Market Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| CrewAI or LangChain adds marketplace features | High | Medium | Move fast on private registries + arena. First-mover advantage in "agent quality assurance" |
| Enterprise sales cycles too long (6-12 months) | Medium | High | Focus on product-led growth first; enterprise sales as expansion |
| AI agent adoption slower than expected | High | Low | Platform-agnostic approach (works with any LLM/framework); expand to non-AI service marketplace |

### Competitive Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| AWS/Azure launches native agent marketplace | Very High | Medium | Differentiate on arena + trust graph (cloud providers won't build competitive testing). Position as "Switzerland" — works across all clouds |
| Open-source alternatives emerge | Medium | Medium | Stay ahead on managed experience. Open-source SDKs/CLI, keep platform proprietary |
| Race to bottom on marketplace fees | Low | Low | 10% is already competitive. Value is in trust graph data, not just routing |

### Regulatory Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| EU AI Act agent requirements | Medium | High | Monitor regulatory developments. Agent approval workflows already align with EU AI Act "high-risk" categorization |
| Data sovereignty laws in new markets | Medium | Medium | Regional deployment from Phase 4. Self-hosted option eliminates risk |
| Liability for agent actions on platform | High | Low | Clear ToS: SignalPot is a marketplace, not an agent provider. Escrow + disputes provide consumer protection |

---

## Appendix A: Technology Stack Evolution

| Component | Current | Enterprise (Cloud) | Enterprise (Self-Hosted) |
|-----------|---------|-------------------|-------------------------|
| **Runtime** | Next.js 16 on Vercel | Next.js 16 on Vercel | Next.js 16 on Docker/K8s |
| **Database** | Supabase (managed PG) | Supabase (managed PG) | PostgreSQL 16 (self-managed) |
| **Auth** | Supabase Auth (GitHub OAuth) | Supabase Auth + SAML/OIDC | Custom OIDC provider or Keycloak |
| **Queue** | Inngest (serverless) | Inngest (serverless) | BullMQ + Redis |
| **Cache** | Upstash Redis | Upstash Redis | Redis (self-managed) |
| **Payments** | Stripe | Stripe | Stripe (still SaaS) or custom invoicing |
| **Monitoring** | Vercel Analytics | Datadog / Sentry | Customer's observability stack |
| **CDN** | Vercel Edge | Vercel Edge | CloudFront / nginx |

## Appendix B: Database Schema Changes for Multi-Tenancy

```sql
-- Core org tables
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan_type plan_type DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  credit_balance_millicents BIGINT DEFAULT 0,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE org_members (
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'developer', 'viewer', 'auditor')),
  invited_at TIMESTAMPTZ DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  PRIMARY KEY (org_id, profile_id)
);

-- Add org_id to existing tables
ALTER TABLE agents ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE api_keys ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE arena_matches ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE trust_edges ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE jobs ADD COLUMN org_id UUID REFERENCES organizations(id);

-- Audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  actor_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_audit_log_org ON audit_log(org_id, created_at DESC);
```

---

*This document should be treated as a living strategy guide. Update quarterly as market conditions, competitive landscape, and customer feedback evolve.*
