# Supabase migrations

## Current state

- 75 migration files in `migrations/`, numbered `00001`–`00092`.
- Numbers `00068`–`00084` were never used (numbering jumped; nothing was deleted).
- `00092_notifications.sql` was formerly `_applied_00037_notifications.sql` — it was
  applied to prod long ago and renamed for CLI compatibility. Its tracked version is `00092`.
- Applied-state is tracked in prod in `supabase_migrations.schema_migrations`
  (the same table the Supabase CLI uses). The baseline was established by
  `scripts/phase0_prod_pack.sql` (Section 3).

Check what prod thinks is applied:

```sql
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
```

## Adding a new migration

1. Create `migrations/000NN_short_name.sql` — next number after the highest existing one.
2. If the migration enables RLS or adds policies, it MUST also include matching
   table-level `GRANT`s for every role the policies target. RLS and GRANTs are
   separate permission layers; a policy without a grant still fails with
   `permission denied for table …` (see the 2026-04-17 agent_telemetry incident).
3. Apply it, either way:
   - **CLI** (preferred): `npx supabase db push` — applies pending migrations and
     records them in `schema_migrations` automatically. Requires `npx supabase login`
     once, and the linked project (`supabase/.temp/linked-project.json`).
   - **SQL Editor** (manual): run the file's contents, then record it:
     ```sql
     INSERT INTO supabase_migrations.schema_migrations (version, name)
     VALUES ('000NN', 'short_name') ON CONFLICT (version) DO NOTHING;
     ```
   Never apply a migration without recording it — the tracking table is only
   useful if it never lies.

## Rules

- Migrations are append-only. Never edit or renumber a file that has been applied.
- Data fixes (UPDATEs) are not schema migrations — put one-off operational SQL in
  `scripts/`, not `migrations/`.
- Prefer idempotent SQL (`IF NOT EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT DO NOTHING`)
  so a re-run is harmless.
