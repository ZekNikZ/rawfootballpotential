---
name: changelog-entry
description: Add a Version History entry (the "what's new" modal on the RFP home page) for a release. Use when shipping a user-visible feature or fix and the owner wants it announced.
---

# Version History entries

The modal reads `site_config.changelog` (a JSON array in Postgres) through `/api/site`; the newest entry by **date** decides
the version the modal compares with the browser's `rfp-last-version-viewed`, so a new newest version opens the modal once for
each visitor. Each entry: `{ "date": ISO string, "title": string, "version": "x.y.z", "description": markdown }`. Existing
entries use `**Heading**` plus `- bullet` lists.

## Two ways to add one

1. **Owner in the admin** (no deploy): Admin -> Site & changelog. Best for wording tweaks. Not versioned in git.
2. **A migration** (in git, deployed with the release): used for 2.0.0 (`packages/db/migrations/0007_changelog_2_0_0.sql`). Steps:
   1. `pnpm --filter @rfp/db exec drizzle-kit generate --custom --name=changelog_<version>` creates an empty migration + journal entry.
   2. Fill it with an **idempotent** upsert, copying the shape of 0007: build the JSON in a small node script (`JSON.stringify([entry])`
      and dollar-quote it with `$cl$...$cl$::jsonb`; assert the JSON does not contain the delimiter), then
      the upsert (the `WHERE` makes it a no-op when the version is already there):

      ```sql
      INSERT INTO "site_config" ("key", "value") VALUES ('changelog', $cl$[...]$cl$::jsonb)
      ON CONFLICT ("key") DO UPDATE
        SET "value" = EXCLUDED."value" || "site_config"."value", "updated_at" = now()
        WHERE NOT ("site_config"."value" @> '[{"version": "<version>"}]'::jsonb);
      ```

   3. Test on a scratch database: create `zz_cl`, run `DATABASE_URL=.../zz_cl pnpm db:migrate`, check the array, set the changelog
      to a legacy-like value and apply the file twice (length must grow by exactly one), then drop the scratch database.
   4. `pnpm db:check`, prettier, commit with the feature.

## Writing the entry

- Version: semver. Features -> minor, fixes -> patch, a big rewrite -> major. Look at the newest existing version first
  (`select value->0->>'version' from site_config where key='changelog'` on the dev DB, or `curl /api/site`).
- Date: today (ISO). Title: short, what changed for the reader. Description: only user-visible things, grouped under bold
  headings (`**Records**`, `**Seasons**`...), one bullet each, no internal jargon (no "derive", "engine").
- If numbers changed on purpose (a record definition changed), say so honestly in one bullet.
