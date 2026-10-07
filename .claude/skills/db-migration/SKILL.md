---
name: db-migration
description: Change the RFP database schema or the rec_* views safely (Drizzle migrations that deploy automatically and must keep the previous image working). Use for any new column/table/view change.
---

# Database migrations

Deploys run `migrate` automatically before the API and worker start, on production data, with no easy undo. So:

1. **Additive only.** New nullable columns or columns with defaults, new tables, new indexes. Never drop or rename a column the previous
   image still reads in the same release; do that in a later release (two steps). The deploy rollback restarts the previous images
   against the already-migrated schema.
2. Edit the schema in `packages/db/src/schema/*.ts`, then `pnpm db:generate`; **read the generated SQL** (`packages/db/migrations/NNNN_*.sql`).
   Hand-written SQL: `pnpm --filter @rfp/db exec drizzle-kit generate --custom --name=<name>`.
3. Views (`rec_*`): change them with `CREATE OR REPLACE VIEW` in a new migration. Postgres only allows **adding columns at the end** of an
   existing view; reordering or removing needs drop + create (and then recreate dependents, as 0006 did for `rec_team_week`).
4. If derive must fill the new column: bump `DERIVE_VERSION` (`apps/ingest/src/derive/derive.ts`); the worker re-derives stale seasons on start.
5. Check: `pnpm db:check`; apply to an empty scratch database (`create database zz_x; DATABASE_URL=.../zz_x pnpm db:migrate`; drop it after);
   run the API tests (`pnpm --filter @rfp/api test`) which use a real database; `pnpm ingest derive` on the dev DB and `sweep-records`.
6. Data migrations (inserts/updates of content such as the changelog): make them **idempotent** (re-running changes nothing).
7. Production backup happens automatically at the start of every Deploy; for risky changes also take a manual dump
   (`docker compose run --rm backup once`) and know the restore command (`docs/cutover.md` sections 3 and 10).
8. The pg-boss schema (`pgboss`) belongs to the worker library, not to Drizzle (`schemaFilter: ["public"]`).
