# Cutover notes and instructions

Written at the end of the rewrite (2026-10-07), for the owner doing the cutover. Everything here was checked against the
code on the `rewrite` branch (commit hashes at the end). Design and definitions are in
[`records-architecture.md`](records-architecture.md); the legacy-vs-new comparison is in
[`m4-parity-report.md`](m4-parity-report.md).

## 0. Reminders (do these, they are easy to forget)

1. **Copy the ESPN bundles to the S3 bucket.** `apps/scraper/bundles/redraft-2020.json.gz` and `redraft-2021.json.gz` are the
   only archive of the ESPN data (ESPN may stop serving past seasons) and the folder is git-ignored. The discovery
   recordings (`discovery-*.json.gz`) are optional. The bundles are also stored verbatim in the database's `raw_payload`
   table, so a database backup holds them too, but keep the files.
2. **Check the emojis in a real browser.** In headless Chromium 💩, 🥇🥈🥉 and 💀🪦 rendered as small icons or missing-glyph
   boxes. That is probably only a font gap in the test browser, but it was never verified in a real one. Look at the
   record filters (🏈 All, 🏆 Playoffs, 💩 Toilet Bowl, 🏅 Postseason), the trophy cabinet and the team names that contain
   emojis.

## 1. What is built

| Milestone | What                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------ |
| M0-M1     | monorepo, Drizzle schema and migrations (0000-0006), `rec_*` views                                     |
| M2        | pure compute (optimal lineups, medians, results, streaks, brackets, tenure, retention)                |
| M3        | Sleeper ingest, derive, NFL reference (nflverse), pg-boss jobs, the one-time Mongo migration           |
| M4        | record engine and API, parity harness                                                                  |
| M5, M7    | public site (records, franchises, trophies, standings, live matchups, teams, rosters, transactions...) |
| M6        | better-auth, invite-only admin (config, corrections, thresholds, players, jobs, import, users, audit)  |
| M8        | the remaining doc 4.5 records: 139 records in all                                                      |
| M9        | ESPN scraper (desktop) and importer; 2020 and 2021 imported from real bundles                          |

Tests: core 74, db 2, ingest 44, api 193, scraper 8, web 5; lint, typecheck and `prettier --check` are clean. CI
(`.github/workflows/ci.yml`) runs lint, typecheck, migrations on an empty database, `drizzle-kit check` and the tests.

## 2. Before you start

- [ ] Decide how `rewrite` becomes `main` (merge or replace). The release workflow builds and pushes the images
      (`ghcr.io/zeknikz/rfp-{migrate,api,ingest,backup,web}`) on a push to `main` or a `v*` tag, so you may want to tag
      `v1.0.0` after merging. Images for a branch push are not built; to test before merging, build locally with
      `docker compose up -d --build`.
- [ ] A host with Docker, and an HTTPS reverse proxy (or Cloudflare Tunnel) that can forward to the `web` container's
      `WEB_PORT`. Nothing else is exposed: Postgres is bound to 127.0.0.1.
- [ ] Keep the legacy site running on `main` until the new one is verified (section 6).
- [ ] Mongo stays **read-only**. Do not shut it down until section 7.

## 3. Get the data into production

The development database already holds everything: all Sleeper seasons (2022-2026, both leagues), the 2020 and 2021 ESPN
seasons imported from the scraped bundles, NFL reference data, thresholds, the legacy placements as corrections, and the
derived tables at the current derive version. It holds **no admin accounts**. The simplest and best-tested path is to move
it.

### Path A (recommended): restore a dump of the development database

On the machine that has the development database (the container is `rfp-db-1`; adjust the name if yours differs):

```sh
# 1. make sure every season is derived with the current code
pnpm ingest derive

# 2. dump (the pg-boss schema is left out: the worker creates its own queues and schedules)
docker exec rfp-db-1 pg_dump -U rfp -d rfp -Fc -N pgboss -f /tmp/rfp-cutover.dump
docker cp rfp-db-1:/tmp/rfp-cutover.dump ./rfp-cutover.dump
```

On the production host (the folder with `docker-compose.yml` and a filled-in `.env`, section 4):

```sh
# 3. start only the database, then restore into the empty database
docker compose up -d db
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error < rfp-cutover.dump

# 4. start everything; `migrate` finds the migrations already applied and exits, the worker re-derives any season
#    whose derive version is behind and schedules its jobs
docker compose up -d
```

### Path B: rebuild from the sources (slower, reproducible)

Run from a checkout with `DATABASE_URL` pointing at the production database (for example through an SSH tunnel to its
127.0.0.1 port), after `docker compose up -d` has applied the migrations:

```sh
pnpm migrate:mongo                                   # needs MONGO_CONNECTION_URL / MONGO_DATABASE; read-only
pnpm ingest all                                      # players, Sleeper seasons, NFL reference, derive
pnpm ingest espn apps/scraper/bundles/redraft-2021.json.gz
pnpm ingest espn apps/scraper/bundles/redraft-2020.json.gz
pnpm ingest nfl-reference
```

Or upload the two bundles in the admin UI instead of the `espn` commands (section 5).

In the production images the same commands run as `docker compose run --rm ingest node dist/cli.js <command>`
(for example `derive`, `nfl-reference`, `sync --season redraft-2026`, `espn <bundle>`; the bundle file has to be mounted).

## 4. Production configuration (`.env`, never committed)

Copy `.env.example` to `.env` and set at least:

| Variable                                                     | Notes                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                                          | a real password                                                                                               |
| `BETTER_AUTH_SECRET`                                         | `openssl rand -base64 32`. Changing it later logs everyone out                                                |
| `PUBLIC_URL`                                                 | the real `https://` address; used for cookies and the Origin check on admin writes                            |
| `RFP_TAG`                                                    | the release tag or SHA to deploy (rollback = the previous tag)                                                |
| `WEB_BIND` / `WEB_PORT`                                      | where the reverse proxy sends traffic (bind to 127.0.0.1 if the proxy is on the same host)                    |
| `TZ`                                                         | `America/New_York`: the cron schedules follow it                                                              |
| `S3_BUCKET`, `S3_ENDPOINT_URL`, `AWS_*`                      | for off-machine backups (section 8); empty keeps backups local                                                |
| `MONGO_*`                                                    | only for path B; delete after cutover                                                                         |
| `EXTRA_ORIGINS`                                              | leave empty in production (it is for the Vite dev server)                                                     |

## 5. First start

1. `docker compose ps`: `db`, `api`, `ingest`, `web` and `backup` should be up; `migrate` exited 0. `curl https://<domain>/api/healthz`
   should report the database and the last `daily` / `finalize` runs (UptimeRobot can watch this URL).
2. **Create the owner account** (there is no sign-up). In the API image:
   `docker compose run --rm -it api node dist/create-owner.js --email you@example.com --name "Your Name"`
   (it asks for a password of at least 12 characters, not echoed; or set `ADMIN_PASSWORD` for the one command).
3. Sign in at `/admin/login`. Invite other admins from Users (the invite is a one-time link you share; nothing is emailed).
4. Admin → Jobs → run **daily**, then **recompute** for one season, and check the run appears with a success status.
5. Admin → Import: only if you used path B without the `espn` commands: upload `redraft-2021.json.gz` and `redraft-2020.json.gz`
   (150 MB limit); the worker normalizes them and the run, with its report, appears under Jobs.
6. Admin → Players: the unmatched-player queue should be empty (the 2020 and 2021 bundles matched every player).

## 6. Verify before switching traffic (manual checklist)

Compare against the legacy site where it makes sense; expected differences are listed in section 9.

- [ ] **Home** for both leagues: season snapshot, blog posts, Version History opens once per new version.
- [ ] **Records**: Overall, Single Season and Managers for both leagues. Try the Time (scope) filter, the median filter, a
      season, the franchise and opponent filters, "1/S" (one per season) and paging. Filters are in the URL, so a copied link
      reproduces the view. Spot-check a handful of numbers against the legacy site.
- [ ] **New records** (the doc 4.5 list): Luck and Regret, Projections, NFL Byes and Inactives, Pickups and Trades, Players,
      Draft, Rivalries, Droughts and Dynasties. Read the one-line description under each picker; the definitions that were
      open are written up in doc section 3.11.3.
- [ ] **Franchise pages** (heatmap, profile, trophy cabinet): they use the franchise's current manager.
- [ ] **Season pages** for every season of both leagues: Standings (week picker), Matchups (live badge in season,
      lineups, "2-week game" badge in 2020 weeks 14-15), Teams and Rosters, Transactions (filters), Draft, and Future Picks
      for dynasty.
- [ ] **2020 and 2021 (ESPN)**: lineups, transactions and drafts exist; 2020's playoff weeks are two-week games with no
      lineups; 2020 has nine teams (one team has no game each week).
- [ ] **Admin**: sign-in, invite and accept, a score correction with a reason (and its undo), thresholds, record settings
      (hide / feature a record), the unmatched-player queue, jobs, the audit log, user disable / role change, password reset.
- [ ] **Phone and dark mode**: no sideways page scroll, tables scroll inside their own frame.
- [ ] **Emojis** (reminder 2 above).
- [ ] **Backups**: `docker compose run --rm backup once`, confirm the dump in `./backups` and, if configured, in the bucket;
      try a restore into a scratch database (`pg_restore --clean --if-exists -d <url> <dump>`).
- [ ] **Uptime** monitor on `/api/healthz`.

Then point the domain at the new stack. Keep the legacy deployment for a few days so you can switch back.

## 7. After the cutover

- [ ] Delete `legacy/` (it is only a reference; the parity harness `pnpm --filter @rfp/api parity` needs it, so run that one last time first if
      you want a final comparison).
- [ ] Shut down Mongo, remove `MONGO_*` from `.env`, and remove the `migrate:mongo` script and `apps/ingest/src/mongo` if you
      like (nothing else depends on them).
- [ ] Rotate anything that was shared during the migration (the Mongo credentials).

## 8. Running it: what happens on its own

| Job                | When                           | What                                                                                              |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `live`             | every 5 min in NFL game windows | current week's scores for the Matchups page only (records never read live data)                   |
| `daily`            | 05:00                          | player dump (at most once a day), rosters, transactions, picks, draft, team names                 |
| `finalize`         | Tuesday and Wednesday 06:00    | marks the finished week complete, recomputes derived data, bumps the season's data version, warms the record cache |
| `nfl-reference`    | 05:30                          | nflverse schedule and weekly rosters (byes, inactives)                                            |
| `season-rollover`  | 07:00                          | picks up a newly created Sleeper league season                                                    |
| backups            | every 24 h                     | `pg_dump` to `./backups` (14 days), plus S3 if configured                                         |

Sleeper is called politely (well under 1,000 calls a minute, the player dump at most once a day, every response cached
in `raw_payload`). A new Sleeper season needs nothing from you: the rollover job finds it. A new ESPN season would be
scraped the same way as 2020 and 2021 (`pnpm scrape:espn --year <year>` on your desktop, after adding the ids to
`apps/scraper/src/leagues.ts` and the season in the admin UI), then imported.

## 9. Known differences from the legacy site, and open items

These are decisions and findings, all written up in the docs; none is an unexplained difference.

- **Why numbers differ from the old site** (details in the parity report): the old site grouped idle playoff teams into
  fake games, counted ESPN playoff-week games that have no bracket (they are now real bracket games), scored dynasty
  2023 interceptions at today's value (the rewrite scores weeks 1-13 as played), took the hand-entered final placements
  (three seasons differed from the brackets by one adjacent pair; the brackets win), ignored medians in default streaks,
  and filled lineups greedily with today's positions (the rewrite computes the exact best lineup with each week's
  position).
- **2020's two-week playoff games** are one game with the combined score, counted for results, totals and placements and left
  out of single-game and lineup records (owner decision).
- **Dynasty 2025** points for differ from Sleeper's own roster totals by 0-3.5 per team with no effect on any result; the
  cause was never found (doc section 7). Records use the served game points.
- **Not built**: cross-season streaks (a possible later record), a TOTP second factor (optional in the design), the
  admin scoping to a league (the model has room for it).
- **Scores and scoring**: a correction (score, game type, placement) is only possible for Sleeper seasons; for ESPN seasons the
  admin refuses it with a message, because those seasons are re-imported from a bundle.
- **ESPN transactions** come from the league feed and from the player cards. Claims that did not execute (failed,
  canceled, still pending at season end) are listed and never counted.

## 10. If something goes wrong

- **Roll back the deploy:** set `RFP_TAG` to the previous tag and `docker compose pull && docker compose up -d`. Migrations are
  not reversed (destructive changes were made two-step on purpose); the previous images keep working with the current schema.
- **A wrong number on a record page:** every record is a plain SQL query over the `rec_*` views; `pnpm --filter @rfp/api show-record <id>`
  (and `sweep-records`) print rows from a database. A season's derived data can be rebuilt without touching sources: Admin →
  Jobs → recompute (with re-normalize, it re-reads the cached raw data and re-applies corrections).
- **Restore from backup:** `pg_restore --clean --if-exists -d <url> rfp-YYYYMMDD-HHMM.dump`, then `docker compose up -d`.
- **Worker looks stuck:** `/api/healthz` shows the last successful `daily` and `finalize`; the Jobs page shows each run's log.
