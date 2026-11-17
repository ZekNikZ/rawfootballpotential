---
name: local-dev
description: Set up and run a local RFP front end and back end (Postgres, API, Vite web app) seeded from the live site's configuration and the public data sources, to test a change in the browser before it ships. Use when asked to run the site locally, try a change against real matchups, or check live-week behavior without touching production.
---

# Local front end + back end

A private copy of the site on `http://localhost:5173`, backed by a local Postgres. The seed comes from the live site
(`GET /api/config-export`: leagues, Sleeper league ids, managers, settings, corrections) and the ingest then pulls the
rest from the public sources. Nothing here writes to production.

## What is and is not seeded

- **Sleeper seasons**: everything (league, rosters, matchups, projections, stats, player dump) from `api.sleeper.app`.
- **NFL reference** (`nfl-reference`, part of `ingest all`): game schedule, weekly rosters and the ID crosswalk from nflverse /
  dynastyprocess on GitHub. Needed for live weeks: live win probability and live projected points read each starter's NFL
  game status and kickoff from it; without it every starter looks finished.
- **ESPN seasons (2020, 2021)**: NOT available. They exist only in the owner's scraped bundles (S3); the live site cannot
  hand them out, and the config file does not create them. Local data is the Sleeper seasons only, so records that span ESPN
  years differ from production. Do not scrape.
- Blog card (`/api/blog`): a Wix RSS feed; 502 when unreachable and the page copes.

Hosts needed (cloud sessions: the environment's network allowlist): `api.sleeper.app`, `rawfootballpotential.com`, `github.com`,
`raw.githubusercontent.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com` (propose them with
`update_environment` if a call is refused with a proxy 403; never use wildcards). `github.com/<other repo>` URLs are blocked in a
cloud session (the importer uses `raw.githubusercontent.com` for the crosswalk for that reason).

Keep to the Sleeper rules in `CLAUDE.md` (well under 1000 calls/min, `players/nfl` at most once a day, every response cached in
`raw_payload`; do not bypass the client or use `--force` casually).

## 1. Prerequisites

- Node 24 (`.nvmrc`) and pnpm 11 (Node 22 also ran everything verified here, with an "Unsupported engine" warning).
- A Postgres (production runs 18; 16 was verified):
  - Docker: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_HOST_PORT=5433` in `.env`, then
    `docker compose up -d db` (only the `db` service). Port 5433 on 127.0.0.1.
  - No Docker (cloud container, root): `service postgresql start`, then
    `su postgres -c "psql -c \"create user rfp with password '<local-only-password>' superuser\" -c 'create database rfp owner rfp'"`.
    Port 5432.
- `pnpm install` once.
- **Cloud sessions (outbound HTTPS goes through a proxy):** Node's built-in `fetch` ignores it (`ENOTFOUND`, "fetch failed"). Prefix every
  command that calls out (`pnpm ingest ...`) with `NODE_USE_ENV_PROXY=1` (Node >= 22.21; `NODE_EXTRA_CA_CERTS` is already set).
  Verified: `NODE_USE_ENV_PROXY=1 pnpm ingest players` loaded 12,229 players; `pnpm ingest nfl-reference --seasons 2026` loaded 272 games.

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

Check `git check-ignore .env` prints `.env` before writing it. Every app finds it by walking up from its cwd.

## 3. Schema

```sh
pnpm db:migrate        # prints "migrations applied"
```

## 4. Seed: configuration from the live site, then the data

```sh
curl -sS -o "$PWD/rfp-config.json" https://rawfootballpotential.com/api/config-export   # public, read-only, 10/min per IP
pnpm ingest import-config "$PWD/rfp-config.json" --dry-run   # expect: would create league(s) ... season(s)
pnpm ingest import-config "$PWD/rfp-config.json"             # creates the leagues and every Sleeper season (cached Sleeper calls)
pnpm ingest all                                              # players, sync every season, season rollover, nfl-reference, derive
pnpm ingest points                                           # per-player weekly points for every season (~190 Sleeper calls, cached)
pnpm ingest import-config "$PWD/rfp-config.json"             # second pass: franchise groupings, corrections, player links (idempotent)
```

- Use **absolute paths** for file arguments: `pnpm ingest` runs inside `apps/ingest`, so a relative path is not found.
- Never commit `rfp-config.json` (check `git status`; keep it in the scratchpad or add it to `.git/info/exclude`).
- The config endpoint exists once the release containing it has deployed (it returned 404 before). If it 404s, ask the owner for the
  file from Admin → Site & changelog → Download configuration, or use the template below.
- Template when only a league id is known: copy `.claude/skills/local-dev/local-config.template.json`, replace `SLEEPER_LEAGUE_ID`,
  `year`, `slug`, `type`, and run the same `import-config`. Never guess league ids.
- A quick look needs less: skip `points`, and `pnpm ingest sync --season <slug-year>` for one season instead of `all`.

## 5. Run it

Two terminals (or background jobs):

```sh
pnpm --filter @rfp/api dev     # Fastify on :8000 (tsx watch)
pnpm --filter @rfp/web dev     # Vite on :5173; proxies /api to :8000 like production
```

Open `http://localhost:5173`. Verified on an empty migrated database: `curl localhost:8000/healthz` →
`{"ok":true,"db":true,...}` and `curl localhost:5173/api/site` returns the API's JSON (proxy works). The API reloads on code changes;
restart it after a `.env` change. Do not run the ingest worker (`pnpm --filter @rfp/ingest dev`): it schedules jobs; use the CLI.

Admin pages (optional): set `BETTER_AUTH_SECRET`, restart the API, `pnpm admin:create-owner --email <you>` (password prompt or
`ADMIN_PASSWORD`; never print it).

Useful checks: `pnpm --filter @rfp/api show-record <record-id>`, `pnpm --filter @rfp/api sweep-records`,
`pnpm --filter @rfp/web smoke` (needs the stack running).

## Live weeks (matchup page, home tiles)

Refresh the current week from Sleeper (what the scheduled `live` job does), then reload the page (it refetches every 30 s while the
week is in progress):

```sh
pnpm ingest sync --season <slug> --mode live
```

Scores change only when you re-run the sync. The NFL game table (`nfl-reference`, already part of `ingest all`) must have the
current season: if live projections look like plain actual points, run `pnpm ingest nfl-reference --seasons <year>` then sync again.

## Cleanup / gotchas

- Stop the servers when done. Dropping the local database loses nothing: re-seed with section 4.
- Never point `DATABASE_URL` at anything but a local database. Production changes only by merging to `main`.
- A finished season is frozen/cached; only the active week changes between syncs.
- The unit tests (`packages/core/src/win-probability.test.ts`) and the API fixture tests cover the live-projection math without any
  network.
