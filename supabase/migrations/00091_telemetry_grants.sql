-- 00091: Table-level GRANTs for agent_telemetry (companion to 00086).
-- 00086 added RLS policies but no GRANTs, so service_role was still blocked
-- at the grant layer ("permission denied for table agent_telemetry").
-- Fixed ad hoc in prod SQL Editor on 2026-04-17 but never committed — if prod
-- is ever restored from a pre-2026-04-17 snapshot, telemetry rollup breaks.
-- This migration makes the fix durable. Safe to re-run (GRANT is idempotent).
--
-- Grants mirror the 00086 policies: service_role gets full CRUD,
-- authenticated gets SELECT + INSERT.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_telemetry TO service_role;
GRANT SELECT, INSERT ON public.agent_telemetry TO authenticated;
