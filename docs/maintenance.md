# Maintaining RFP: how things work, and what was learned

For whoever (a person or Claude) keeps this project running. The design and every record definition are in
[`records-architecture.md`](records-architecture.md); the cutover runbook is [`cutover.md`](cutover.md); automatic
deploys are [`deploy-runner.md`](deploy-runner.md); open work is [`TODO_TASKS.md`](TODO_TASKS.md). Claude Code skills and
agents for recurring jobs live in `.claude/` (see `CLAUDE.md`).

## 1. The system on one page

```
Sleeper API ─┐                                   ┌─ rec_* SQL views ── record engines ── /api/leagues/:l/records/:id
ESPN bundles ┼─> raw_payload ─> normalize ─> canonical tables ─> derive ─┤                              └─ record_cache (keyed by version)
nflverse ────┘   (every response cached)           (league, season, team, matchup, lineup, transactions, ...)
                                                    derive = team_week_stats, game_result, team_season_week, player_tenure, trophies
                                                    then bumps data_version  ─> prewarm of the record cache
```

- **Production**: one VM (docker compose in `/opt/rfp`): `db` (Postgres 18), `migrate` (one-shot), `api` (Fastify, :8000),
  `ingest` (pg-boss worker), `web` (Caddy: static SPA + `/api/*` proxy + `/api/healthz`), `backup`. TLS is outside (reverse
  proxy or tunnel to `WEB_PORT`, default 8080). A **self-hosted GitHub runner** on the same VM deploys (`deploy.yml`).
- **Images**: built on GitHub-hosted runners by `release.yml` on every push to `main` (`ghcr.io/zeknikz/rfp-*`, tagged with
  the commit SHA, `latest`, and the version on `v*` tags with the `v` stripped).
- **Data versions**: `data_version.version` per season (bumped by every derive/finalize), `DERIVE_VERSION` (derive code
  version, in `apps/ingest/src/derive/derive.ts`), `RecordDef.version` (per record, in the catalog), `RESPONSE_VERSION`
  (every response, `apps/api/src/records/run.ts`). The record-cache key hashes all four.
- **Version History** (the modal on the home page) is data, not code: `site_config.changelog` (JSON array), edited in
  Admin -> Site & changelog, or added by a migration (see the `changelog-entry` skill). The modal opens once per new newest version.

## 2. Which version to bump when

| You changed | Bump | Why |
| --- | --- | --- |
| a record's query, columns, definition or ranking | that record's `version` in the catalog | cached answers stop matching on deploy |
| a record that reads seasons outside its Seasons filter (the power rating calibrates on the full history) | set `readsAllSeasons: true` on it | its cache key then covers every season, so a change in any season invalidates it |
| shared engine code (several records) | `version` of every record using that engine | records do not share a version |
| only a record's description or title text | nothing | not part of the cached response (descriptions come from the catalog list) |
| what derive computes (new stats column, changed logic) | `DERIVE_VERSION` (+ migration) | the worker re-derives stale seasons on start and bumps data versions |
| the shape of every record response | `RESPONSE_VERSION` | busts the whole cache |
| nothing about records, only the site UI | nothing | static assets are content-hashed |

## 3. Deploying

Merging to `main` is deploying: Release images -> Deploy (self-hosted) -> backup, `RFP_TAG` = commit SHA, compose pull/up,
wait for `/api/healthz`, roll back to the previous tag if it never becomes healthy. Details and the one-time runner setup:
[`deploy-runner.md`](deploy-runner.md). Manual deploy or rollback: Actions -> Deploy -> Run workflow with `tag`.
After a deploy, run the `post-deploy-verify` skill (or its checklist).

Things the workflow does **not** do: add new variables to `/opt/rfp/.env` (do it before merging a change that needs
them), reverse migrations (they are additive on purpose), or change the reverse proxy.

## 4. Environment gotchas (these cost time once)

- **Windows dev machine, Git Bash**: large heredocs sometimes fail ("unexpected EOF"); write files with the editor tool or a
  small node script. There is no `python` and no `pkill`. Node scripts given `/tmp/...` resolve to `E:\tmp`. Docker
  `-v` paths need `MSYS_NO_PATHCONV=1`. `docs/records-architecture.md` has CRLF on disk (prettier normalizes to LF), so
  scripted edits must normalize `\r\n`. Stop dev servers with `taskkill //PID <pid> //F //T` (find the pid via `netstat -ano`).
- **Playwright**: the bundled Chromium is not installed; use the installed Chrome (`channel: "chrome"`, or
  `PW_CHROMIUM="C:/Program Files/Google/Chrome/Application/chrome.exe" pnpm --filter @rfp/web smoke`). The smoke test needs
  the API (`pnpm --filter @rfp/api dev`) and the web dev server (`pnpm --filter @rfp/web dev`) running.
- **Dev database**: docker container `rfp-db-1`, host port 5433, credentials in the git-ignored root `.env`
  (`DATABASE_URL`, `TEST_DATABASE_URL`). API tests use a real database. Never print `.env`.
- **gh**: `gh auth login` is needed once per machine; PRs are normally merged by the owner, or by Claude when asked.
- **Prettier** normalizes everything; run `npx prettier --write <files>` before committing, `pnpm format:check` is in CI.
- **Sleeper**: never loop over its API without caching; `players/nfl` at most once a day (the worker enforces it).

## 5. Design decisions that look like bugs but are not

(Full list: `records-architecture.md` section 2 and 3.11, and `cutover.md` section 9.)

- Records show a franchise's **current manager**; one-season rows show that season's manager.
- 2020 ESPN playoff weeks 14-15 are **one two-week game** counted for standings/placements/H2H and excluded from
  single-game and lineup records. 2020 has nine teams (one bye each week).
- Final placements come from the **brackets**, not the hand-entered legacy placements (three seasons differ by one adjacent pair).
- Dynasty 2023 weeks 1-13 are scored **as played** (not at today's scoring). Dynasty 2025 PF differs from Sleeper totals by 0-3.5.
- ESPN seasons cannot be corrected in the admin (they are re-imported from a bundle); Sleeper seasons can, and corrections survive re-ingest.
- Streaks are per season. Ties share a rank. Lineup IQ is points / exact optimal lineup points.

## 6. Emoji font

The site bundles **Twemoji** (`twemoji-colr-font`, COLRv0 woff2, 476 KB) in `apps/web/src/main.tsx`, placed in the Mantine
font stack (`apps/web/src/theme.ts`) after the system text fonts and before the platform emoji fonts. A credit line is under the
navigation (`Layout.tsx`); the font is OFL and the artwork CC-BY 4.0, so keep the credit. Noto Color Emoji from fontsource was
tried first: its split files rendered blank in Chrome on Windows. Keycap emojis (1️⃣) are not in Twemoji and use the system font.

## 6b. Stale tabs after a deploy

Every deploy replaces the hashed files under `/assets`. A tab opened before it can fail to load a lazy route. `apps/web/src/lib/preload-recovery.ts`
reloads once (to the page being opened, at most once per 30 s); `infra/Caddyfile` returns a real 404 (`no-store`) for a missing asset so the
browser never mistakes `index.html` for a script or stylesheet.

## 7. Where things are

| Need | Look at |
| --- | --- |
| a record's definition / filters | `packages/core/src/records/catalog.ts`, `catalog-extra.ts`, `descriptions.ts` |
| a record's SQL | `apps/api/src/records/engines/*`, registered in `apps/api/src/records/run.ts` (`ENGINES`) |
| what derive computes | `apps/ingest/src/derive/derive.ts`, pure parts in `packages/core/src` |
| the SQL views the records read | `packages/db/migrations/0001_rec_views.sql`, later `CREATE OR REPLACE VIEW` migrations |
| the ESPN scraper / importer | `apps/scraper/`, `apps/ingest/src/espn/` |
| admin API / UI | `apps/api/src/admin/`, `apps/web/src/admin/` |
| the job schedule | `apps/ingest/src/worker.ts`, handlers in `apps/ingest/src/jobs/handlers.ts` |
| server setup / compose / images | `infra/setup-server.sh`, `docker-compose.yml`, `infra/Dockerfile`, `infra/Caddyfile` |
| CI / release / deploy | `.github/workflows/{ci,release,deploy}.yml` |
