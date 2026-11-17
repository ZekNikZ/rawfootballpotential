---
name: local-dev
description: Set up and run a local RFP front end and back end (Postgres, API, Vite web app) that fetches ONLY Sleeper data, to test a change in the browser before it ships. Use when asked to run the site locally, try a change against real matchups, or check live-week behavior without touching production, ESPN or nflverse.
---

# Local front end + back end (Sleeper data only)

Goal: a private copy of the site on `http://localhost:5173` backed by a local Postgres filled from Sleeper, so a change
(a page, a matchup calculation, a record) can be seen working. Nothing here touches production.

## What may call out (and what must not)

| Call                                                                                        | Host                               | Allowed?                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Sleeper league, rosters, matchups, projections, stats, player dump                          | `api.sleeper.app`                  | **yes**, the point of this skill                                                                                                                |
| Team avatars the browser shows                                                              | `sleepercdn.com`                   | yes (browser only)                                                                                                                              |
| `pnpm ingest nfl-reference`, and `pnpm ingest all` / `job nfl-reference` (which include it) | nflverse / GitHub                  | **no** by default, see "Live weeks"                                                                                                             |
| `pnpm ingest espn <bundle>`, `apps/scraper`                                                 | ESPN                               | **no** (ESPN seasons are not needed locally)                                                                                                    |
| the ingest **worker** (`pnpm --filter @rfp/ingest dev`)                                     | schedules jobs incl. nfl-reference | **no**: run single CLI commands instead                                                                                                         |
| `/api/blog` (home page blog card)                                                           | a Wix RSS feed                     | the one non-Sleeper call the API makes; it returns 502 when unreachable and the page copes. Leave it, or set `BLOG_FEED_URL` to something local |

Keep to the Sleeper rules in `CLAUDE.md`: well under 1000 calls/min, `players/nfl` at most once a day, every response is
cached in `raw_payload` (the client does this; do not bypass it, and do not use `--force` casually).

## 1. Prerequisites

- Node 24 (`.nvmrc`) and pnpm 11. Node 22 also ran everything here with only an "Unsupported engine" warning.
- A Postgres (the project runs 18; 16 was verified). Either:
  - Docker: put `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_HOST_PORT=5433` in `.env`, then
    `docker compose up -d db` (only the `db` service; never `up` the whole stack). Port 5433 on 127.0.0.1.
  - No Docker (verified in the cloud container, root shell): `service postgresql start`, then
    `su postgres -c "psql -c \"create user rfp with password '<local-only-password>' superuser\" -c 'create database rfp owner rfp'"`.
    Port 5432.
- `pnpm install` once.

## 2. `.env` (repo root, git-ignored, never committed or printed)

```
DATABASE_URL=postgres://rfp:<password>@localhost:<5432|5433>/rfp
PORT=8000
PUBLIC_URL=http://localhost:5173
EXTRA_ORIGINS=http://localhost:5173
LOG_LEVEL=info
# TEST_DATABASE_URL=...   only for `pnpm test` (API tests use a real database)
# BETTER_AUTH_SECRET=...  only for the admin UI: `openssl rand -base64 32`
```

Check `git check-ignore .env` prints `.env` before writing anything into it. All apps find it by walking up from their cwd.

## 3. Schema

```sh
pnpm db:migrate        # prints "migrations applied"
```

## 4. Leagues and seasons (Sleeper only)

The database starts empty. `import-config` creates leagues and **creates each Sleeper season from its league id** (one
cached Sleeper round trip each). Two ways to get the file:

- **Full configuration** (people, settings, corrections too): `curl -o rfp-config.json https://rawfootballpotential.com/api/config-export` (public, read-only; also Admin → Site & changelog → Download)
  (the owner has it). ESPN seasons in it are skipped by the importer; fine locally.
- **Minimal**: copy `.claude/skills/local-dev/local-config.template.json` into the scratchpad, replace `SLEEPER_LEAGUE_ID` with a
  real Sleeper league id (ask the owner; never guess ids) and `year`/`slug`/`type` to match. Add more `seasons` entries for
  older years if wanted (each needs its own league id; `rollover` only finds _newer_ seasons).

```sh
pnpm ingest import-config "$PWD/<file>" --dry-run   # must say: would create league ... season(s)
pnpm ingest import-config "$PWD/<file>"
```

Use an **absolute path**: `pnpm ingest` runs inside `apps/ingest`, so a relative path is not found. (The template passes
the dry-run in this repo.)

## 5. Fetch the data (Sleeper only, one command at a time)

```sh
pnpm ingest players                      # Sleeper player dump (cached 20 h)
pnpm ingest sync --season redraft        # a league slug, or slug-year (redraft-2025), or all
pnpm ingest points --season redraft      # optional: per-player weekly points for every season (~190 calls); skip for a quick look
pnpm ingest derive --season redraft      # recompute derived tables and records data
```

Do **not** use `pnpm ingest all` (it adds nfl-reference). Run the second `import-config` pass from `docs/maintenance.md`
section 4 only if using the full configuration file.

## 6. Run it

Two terminals (or background jobs):

```sh
pnpm --filter @rfp/api dev     # Fastify on :8000 (tsx watch), logs requests
pnpm --filter @rfp/web dev     # Vite on :5173; proxies /api to :8000 like production
```

Open `http://localhost:5173`. Verified on an empty migrated database: `curl localhost:8000/healthz` →
`{"ok":true,"db":true,...}`, and `curl localhost:5173/api/site` returns the same JSON as the API (proxy works).
The API picks up code changes itself (watch); Vite hot-reloads the web app. Restart the API after a `.env` change.

Admin pages (optional): set `BETTER_AUTH_SECRET`, restart the API, `pnpm admin:create-owner --email <you>` (password prompt or
`ADMIN_PASSWORD`; never print it).

Useful checks: `pnpm --filter @rfp/api show-record <record-id>`, `pnpm --filter @rfp/api sweep-records`,
`pnpm --filter @rfp/web smoke` (needs the stack running).

## Live weeks (the matchup page and home tiles)

Refresh the current week's scores and projections from Sleeper (this is exactly what the scheduled `live` job does):

```sh
pnpm ingest sync --season redraft --mode live
```

The page refetches every 30 s when the week is in progress; the data only changes when you re-run the sync.

**Known limit:** live win probability and live projected points need each starter's NFL game (status and kickoff). In a live
week that comes from the `nfl_game` / `nfl_team_week` tables, filled by `nfl-reference`, which is not a Sleeper source.
Without it those games have no status and every player is treated as finished (their actual points). So to see in-progress
projections, you need this one extra, nflverse call, which is **outside** the Sleeper-only rule: ask the owner before running
`pnpm ingest nfl-reference --seasons <year>`, then re-run `sync --mode live`. Otherwise unit tests
(`packages/core/src/win-probability.test.ts`) and the API tests with fixture leagues are the way to check the math.

## Cleanup / gotchas

- Stop the servers when done (they are not deployed anywhere). Dropping the local database loses nothing: the next
  `sync` refills it from the cached `raw_payload` (while the DB lives) or from Sleeper.
- Never point `DATABASE_URL` at anything but a local database. Production is only changed by merging to `main`.
- A Sleeper sync of a finished season is frozen/cached; for an active week, re-sync after games to see change.
- Not verified in this container (Sleeper is blocked by its network proxy: 403): the Sleeper fetch steps themselves.
  Everything else above (Postgres, migrate, config dry-run, API, web, proxy) was run.
