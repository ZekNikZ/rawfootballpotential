---
name: add-metric
description: Add or change a record/metric on the RFP site end to end (catalog entry, engine, derived data, tests, docs) and say what the deploy needs. Use when the owner asks for a new record, stat, leaderboard or column, or to change how an existing one is computed.
---

# Adding or changing a metric

## 0. Decide the shape (ask the owner if a case changes what is shown)

Write the one-line definition first, including ties, byes, playoffs, two-week games (`span_weeks = 2`), which manager
is shown, and whether in-progress seasons count. Anything ambiguous: ask, then record it in
`docs/records-architecture.md` section 3.11.3 and in the record's `description` (shown under the picker).

## 1. Can it be computed from data that already exists?

Look at what is available before adding anything: the `rec_*` views (`packages/db/migrations/0001_rec_views.sql` and
later `CREATE OR REPLACE` migrations), `team_week_stats`, `game_result`, `team_season_week`, `player_tenure`, transactions.

- **Yes** -> steps 2-3 and 5-7 only.
- **No, it needs a per-week or per-team value stored** (like asleep-at-the-wheel) -> also step 4.

## 2. Catalog entry (`packages/core/src/records/catalog-extra.ts`, or `catalog.ts` for base records)

Use the `rec(id, title, base, sortKey, direction, columns, description)` helper. Pick `category`, `section`, `grain`,
`engine`, `filters` (`GAME_FILTERS` / `SEASON_FILTERS` / `CAREER_FILTERS` or custom), `requires` (data a season must
have, e.g. lineups, so ESPN 2020 weeks without lineups are excluded) and `active` (`include`, ...). Ids are stable
URLs: never rename one casually.
**Every record needs a description** (shown under the picker): in `catalog-extra.ts` pass it as the 7th argument of `rec(...)`; in `catalog.ts` the 7th
argument is the legacy name, so put the description in `packages/core/src/records/descriptions.ts` instead. A test fails without one.

## 3. Engine (`apps/api/src/records/engines/*`)

Reuse an existing engine when the grain matches (`extraTeamWeek`, `teamSeason`, `careerStandings`, `playerSeason`,
`trade`, ...); otherwise add a function and register it in the `ENGINES` map in `apps/api/src/records/run.ts`.
Rules every engine follows:

- read the `rec_*` views, never raw tables, and respect the shared filters (`seasons`, `scope`, `weeks`, `franchise`, `opponent`, `onePer`, `minGames`);
- single-game records add `tw.span_weeks = 1`; lineup records exclude weeks without lineups;
- return rows through `rankRows` (ties share a position; set `sort_value`, `data`, `refs`, `in_progress`, `tie_key`);
- team/manager owner labels go through `resolveRows` (`entities.ts`); do not build names by hand.

## 4. Only if it needs stored data

1. Add the column in `packages/db/src/schema/derived.ts` (or the right schema file); `pnpm db:generate`; read the SQL it wrote.
   Keep migrations additive (nullable or with a default) so the previous image still works after the migration.
2. If a view must expose it: a new migration with `CREATE OR REPLACE VIEW` (new columns **last**), as `0006` did.
3. Compute it in `apps/ingest/src/derive/derive.ts` (pure logic belongs in `packages/core` with its own unit test).
4. **Bump `DERIVE_VERSION`** in `derive.ts`. On the next start the worker re-derives every season whose derive version is behind.
5. Re-derive the dev DB: `pnpm ingest derive`.

## 5. Tests

- Pure logic: `packages/core/src/*.test.ts`.
- The record: add cases to `apps/api/test/records-extra.test.ts` (or the closest file) against the hand-built fixture world,
  with the expected answer worked out by hand, not copied from the output. Cover a tie, a bye or missing-data case, and
  the two-week game case if relevant.

## 6. Verify on real data

```sh
pnpm --filter @rfp/api show-record <id>      # eyeball the top rows; cross-check one number with a SQL query
pnpm --filter @rfp/api sweep-records         # no failures across filters
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm db:check
```

If the UI needs a new column type or filter, see `apps/web/src/api/schemas.ts` (zod) and the records page components;
run `pnpm --filter @rfp/web smoke` with the stack up.

## 7. Docs, commit, and tell the owner how to deploy

Update the record count/section in `docs/records-architecture.md` (3.11.3) and `docs/cutover.md` section 1 if numbers
changed. Commit on a branch; open a PR only if asked. In your answer say which case applies (see `deploy-and-operate`):

- **new record from existing data:** deploy images only; the first request computes and caches it;
- **new derived column / derive change:** migration + `DERIVE_VERSION` bump; the worker re-derives on start, watch Admin -> Jobs;
- **changed definition of an existing record:** increment its `version` in the catalog (`RecordDef.version`, default 1). It is part of
  the response-cache key (`versionKey` in `apps/api/src/records/run.ts`), so old cached answers stop matching on deploy and the API
  pre-warms the new ones at startup; no recompute is needed. Records sharing an engine do not share a version: if you change shared
  engine code, bump every record that uses that engine. Bump `RESPONSE_VERSION` in `run.ts` only when the shape of _every_
  response changes. A _derive_ change bumps `DERIVE_VERSION` (see step 4) instead.
