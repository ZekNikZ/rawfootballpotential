# Raw Football Potential (RFP)

Fantasy-football league history and records site (two leagues: `redraft`, `dynasty`). Rewritten from scratch; the old
app is in `legacy/` (reference only, to be deleted). Owner: Matthew. Design and definitions: `docs/records-architecture.md`
(the source of truth; section 2 fixes semantics, 3.11.3 defines the "additional" records, 3.11.4 the ESPN importer).
Cutover and operations: `docs/cutover.md`. Legacy-vs-new numbers: `docs/m4-parity-report.md`.

## Layout

pnpm 11 workspaces + Turborepo, Node 24, TypeScript strict, ESM.

| Path            | What                                                                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` | pure compute, no I/O: optimal lineups, medians, game results, streaks, brackets, tenure, asleep-at-the-wheel, **the record catalog** (`src/records/catalog.ts`, `catalog-extra.ts`), zod schemas (`@rfp/core/admin` has the ESPN bundle schema) |
| `packages/db`   | Drizzle schema (`src/schema/*`), migrations (`migrations/`), the `rec_*` SQL views the records read                                                                                                                                             |
| `apps/ingest`   | worker (pg-boss jobs/schedules), Sleeper sync, ESPN importer, NFL reference (nflverse), **derive** (`src/derive/derive.ts`), one-time Mongo migration, CLI                                                                                      |
| `apps/api`      | Fastify API: record engines (`src/records/engines/*`), info pages, better-auth admin, tests                                                                                                                                                     |
| `apps/web`      | React 19 / Mantine 9 / React Router / TanStack Query; browser smoke test in `scripts/smoke.ts`                                                                                                                                                  |
| `apps/scraper`  | desktop-only ESPN scraper (Playwright, headed Chrome, manual login); not deployed                                                                                                                                                               |
| `infra`         | Dockerfile (targets migrate/api/ingest/web/backup), `setup-server.sh`, Caddy config                                                                                                                                                             |

Data flow: sources -> `raw_payload` (every response cached) -> normalize -> canonical tables -> **derive**
(`team_week_stats`, `game_result`, `team_season_week`, `player_tenure`, trophies) -> `data_version` bump -> records read
`rec_*` views -> responses cached in `record_cache` keyed by (record, params, data versions of the seasons read).

## Commands

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm db:check   # the full gate (turbo runs per package)
pnpm db:generate                       # new migration after a schema change (then pnpm db:migrate)
pnpm --filter @rfp/api show-record <record-id>   # print a record's rows from the dev DB
pnpm --filter @rfp/api sweep-records             # run every record x common params; must finish with no failures
pnpm ingest <command>                  # derive | sync | nfl-reference | espn <bundle> | all ...
pnpm admin:create-owner                # first admin account
pnpm --filter @rfp/web smoke                     # browser smoke (needs the stack running)
```

Dev DB: Postgres in docker (`rfp-db-1`, host port 5433); `.env` at the repo root has `DATABASE_URL` and
`TEST_DATABASE_URL`. API tests run against a real database.

## Hard rules

- **Never print, log or commit secrets** (`.env`: Mongo URL, `BETTER_AUTH_SECRET`, DB passwords, S3 keys). Check `git diff` before committing.
- **Mongo is read-only**, and only used by the one-time migration.
- **Sleeper politeness:** well under 1000 calls/min, `players/nfl` at most once a day, cache every response in `raw_payload`.
- **Do not guess record semantics.** If a case changes what a record shows (ties, byes, two-week games, playoffs,
  which manager gets credit), ask the owner, then write the decision into the doc (section 3.11.3) and the record's description.
- Smallest change when something does not work; note deviations in the doc.
- Work on a branch; commit/push/PR only when asked. Never push to `main` directly. Never force-push.
- Commit trailers: `Co-Authored-By: <current model> <noreply@anthropic.com>` and the `Claude-Session:` line from the system reminder.
- TypeScript strict; zod at boundaries; keep `.prettierrc` style (LF); no `any` without a comment.
- Finish every change with the checks actually run, and report failures honestly.

## Settled decisions (details in the doc and `docs/cutover.md` section 9)

- Records show a franchise's **current manager**; single-season/single-event rows show that season's team and manager;
  heatmap/profile/trophies/picks use the current manager.
- Ties share a rank position. Per-season streaks (cross-season streaks are not built).
- ESPN 2020 playoff weeks 14-15 are **one two-week game** (`matchup.span_weeks = 2`): counted for W-L, PF/PA,
  standings, placements, head-to-head; **excluded** from single-game and lineup records. 2020 has nine teams.
- Admin corrections (score, game type, placement) are refused for ESPN seasons (they re-import from a bundle).
- Dynasty 2025 PF differs from Sleeper totals by 0-3.5 per team; unexplained, accepted.

## Skills (in `.claude/skills/`)

- `add-metric`: add or change a record/metric end to end (catalog, engine, derive, tests, docs, deploy implications).
- `deploy-and-operate`: how a change reaches production, the server layout, backups, rollback, and answering "how do I keep it up to date" questions.
- `data-problems`: a number looks wrong, a job is stuck, a new season or ESPN bundle arrives.

## Still owed to the owner

Copy `apps/scraper/bundles/redraft-2020.json.gz` and `redraft-2021.json.gz` to the S3 bucket (git-ignored, the only
archive of the ESPN data); check emoji rendering (💩 🥇🥈🥉 💀🪦) in a real browser.
