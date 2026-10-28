-- ============================================================
-- Phase 0 prod pack — run in Supabase SQL Editor (2026-07-10)
-- Run SECTION 1 first, read the results, then run SECTION 2.
-- ============================================================

-- ============ SECTION 1: VERIFY ============

-- 1a) Is migration 00027 (analytics functions) applied? Expect 3 rows.
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('get_org_usage_stats', 'get_org_top_agents', 'get_org_daily_usage');

-- 1b) Is migration 00028 (provider_cost) applied? Expect 1 row.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'provider_cost';

-- 1c) agent_telemetry grants — expect service_role with 4 privileges,
--     authenticated with SELECT/INSERT. Missing rows = the 2026-04-17
--     ad-hoc GRANT was lost (or never mirrored for authenticated).
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'agent_telemetry'
  AND grantee IN ('service_role', 'authenticated')
ORDER BY grantee, privilege_type;

-- 1d) Current rate for the-next-step — expect 0.002 (the known-stale value).
SELECT slug, rate_amount FROM agents WHERE slug = 'the-next-step';

-- ============ SECTION 2: FIX ============

-- 2a) Rate sync: agent code charges $0.003 but DB still says $0.002
--     (callers undercharged since March 2026).
UPDATE agents SET rate_amount = 0.003 WHERE slug = 'the-next-step';

-- 2b) Migration 00091 — durable agent_telemetry grants (idempotent).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_telemetry TO service_role;
GRANT SELECT, INSERT ON public.agent_telemetry TO authenticated;

-- 2c) ONLY if 1a returned fewer than 3 rows:
--     run the full contents of supabase/migrations/00027_analytics_views.sql
--     (CREATE OR REPLACE — safe to re-run).

-- 2d) ONLY if 1b returned 0 rows:
--     ALTER TABLE jobs ADD COLUMN provider_cost NUMERIC DEFAULT NULL;
--     COMMENT ON COLUMN jobs.provider_cost IS 'Agent self-reported upstream API cost in USD (e.g., LLM provider cost)';

-- ============ SECTION 3: MIGRATION TRACKING BASELINE ============
-- Run ONLY after Section 2 (so every listed migration is truly applied).
-- Creates the same bookkeeping table the Supabase CLI uses, and marks all
-- 75 repo migrations as applied. From then on, applied-state is queryable:
--   SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
-- and `npx supabase migration list --linked` will agree with the repo.
-- Note: _applied_00037_notifications.sql was renamed to 00092_notifications.sql
-- in the repo; it is tracked here as version 00092.

CREATE SCHEMA IF NOT EXISTS supabase_migrations;

CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text NOT NULL PRIMARY KEY,
  statements text[],
  name text
);

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('00001', 'initial_schema'),
  ('00002', 'security_hardening'),
  ('00003', 'api_keys'),
  ('00004', 'grants'),
  ('00005', 'plans'),
  ('00006', 'agent_identity'),
  ('00007', 'trust_hardening'),
  ('00008', 'escrow'),
  ('00009', 'disputes'),
  ('00010', 'dispute_panels'),
  ('00011', 'constraints'),
  ('00012', 'trust_signals'),
  ('00013', 'webhook_events'),
  ('00014', 'rpc_hardening'),
  ('00015', 'anonymous_proxy'),
  ('00016', 'arena'),
  ('00017', 'arena_judge'),
  ('00018', 'arena_rubrics'),
  ('00019', 'arena_levels'),
  ('00020', 'atomic_vote'),
  ('00021', 'settle_user_payment'),
  ('00022', 'organizations'),
  ('00023', 'org_rls'),
  ('00024', 'security_hardening_v2'),
  ('00025', 'trust_cooldown'),
  ('00026', 'private_agents'),
  ('00027', 'analytics_views'),
  ('00028', 'provider_cost'),
  ('00029', 'fix_org_members_recursion'),
  ('00030', 'autotune'),
  ('00031', 'atomic_dispute_deposit'),
  ('00032', 'arena_billing_notes'),
  ('00033', 'processors'),
  ('00034', 'suite_agents'),
  ('00035', 'keykeeper_secrets'),
  ('00036', 'keykeeper_intake'),
  ('00037', 'lookup_user_by_email'),
  ('00038', 'add_providers'),
  ('00039', 'analyst_suite_sources'),
  ('00040', 'analyst_suite_dimensions'),
  ('00041', 'analyst_suite_entities'),
  ('00042', 'analyst_suite_aliases'),
  ('00043', 'analyst_suite_validation_rules'),
  ('00044', 'analyst_suite_datasets'),
  ('00045', 'analyst_suite_records'),
  ('00046', 'arena_eligible'),
  ('00047', 'analyst_validation_runs'),
  ('00048', 'analyst_anomalies'),
  ('00049', 'analyst_templates'),
  ('00050', 'analyst_pipeline_runs'),
  ('00051', 'analyst_account_health'),
  ('00052', 'analyst_opportunities'),
  ('00053', 'analyst_playbook_outputs'),
  ('00054', 'analyst_table_grants'),
  ('00055', 'arena_api_costs'),
  ('00056', 'a2a_push_notifications'),
  ('00057', 'architect_columns'),
  ('00058', 'agent_telemetry'),
  ('00059', 'challenge_patterns'),
  ('00060', 'marketplace_connectors'),
  ('00061', 'compliance_patterns'),
  ('00062', 'databricks_provider'),
  ('00063', 'repair_compliance_patterns'),
  ('00064', 'query_performance_indexes'),
  ('00065', 'agent_health_coaching'),
  ('00066', 'synthetic_trust_flag'),
  ('00067', 'e2e_encryption'),
  ('00085', 'constraint_challenge_sets'),
  ('00086', 'fix_telemetry_rls'),
  ('00087', 'middle_out_runs'),
  ('00088', 'fix_middle_out_rls'),
  ('00089', 'blog_drafts'),
  ('00090', 'drop_blog_drafts'),
  ('00091', 'telemetry_grants'),
  ('00092', 'notifications')
ON CONFLICT (version) DO NOTHING;
