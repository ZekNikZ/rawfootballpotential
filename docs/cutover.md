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
2. **Emojis** are rendered with a bundled font (Twemoji, `twemoji-colr-font`, credited in the navigation) so they look the same on
   every device; Windows' own font lacks newer ones such as the tombstone. Glance at the record filters (🏈 All, 🏆 Playoffs,
   💩 Toilet Bowl, 🏅 Postseason) and the trophy cabinet on a phone and a Mac if you can. Keycap emojis such as 1️⃣ are not in
   the font and fall back to the system.

## 1. What is built

| Milestone | What                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------ |
| M0-M1     | monorepo, Drizzle schema and migrations (0000-0007), `rec_*` views                                     |
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

**The plan: a new server, then repoint DNS.** The new app runs on a different server from the legacy site. The legacy
site is not touched or redeployed: it keeps serving rawfootballpotential.com from the old server until you repoint the
domain, and stays untouched afterwards, so it is also the rollback (section 10).

- [ ] **Merge `rewrite` into `main` with a PR.** The release workflow builds and pushes the images
      (`ghcr.io/zeknikz/rfp-{migrate,api,ingest,backup,web}`) on a push to `main` or a `v*` tag. Image tags are the full
      commit SHA, `latest` (newest `main` build) and, for a git tag `vX.Y.Z`, `X.Y.Z` (the `v` is stripped). Set `RFP_TAG` to `latest` or a SHA
      (or `1.0.0` if you tag a release); wait for the Release workflow to finish before pulling. Nothing
      else deploys from `main`, so merging does not affect the old server (check that nothing there auto-pulls `main`).
      To try the stack before merging, build locally on the new server with `docker compose up -d --build`.
- [ ] **The new server**: Docker with the compose plugin, this repo's `docker-compose.yml` and `.env` (no need for the
      source tree, only those two files, or a clone of `main`), and the GHCR images pullable (`docker login ghcr.io` if
      the packages are private). Open ports 80/443 only; Postgres is bound to 127.0.0.1.
- [ ] **Automatic deploys (optional, recommended):** install the self-hosted runner on this server and every merge to
      `main` deploys itself: `docs/deploy-runner.md`. Without it, deploy by hand (set `RFP_TAG`, `docker compose pull && docker compose up -d`).
- [ ] **Reverse proxy:** forward **everything** for rawfootballpotential.com (and www) to `http://<server>:<WEB_PORT>`, no path
      prefix or rewriting. The `web` container serves the site at `/` and proxies `/api/*` to the API itself, so the API has no
      separate address or port and the browser only ever talks to the one origin (which is also why cookies and CORS just work).
      Pass the usual `X-Forwarded-For` / `X-Forwarded-Proto` headers (most proxies do by default) and allow WebSocket/HTTP keep-alive defaults.
- [ ] **HTTPS in front of `web`**: a reverse proxy or Cloudflare Tunnel on the new server, forwarding to `WEB_PORT`, with
      a certificate for rawfootballpotential.com. If the certificate is issued by HTTP challenge it can only be issued once
      DNS points at the server; use a DNS challenge (or Cloudflare) to have the certificate ready before the switch.
- [ ] **Lower the DNS TTL** of rawfootballpotential.com (and www) to about 300 s a day ahead, so the switch and a possible
      switch back take minutes. Note the current records (A/AAAA/CNAME) so you can restore them.
- [ ] Mongo stays **read-only** and the legacy site stays up on the old server until section 7.

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

### Path B: rebuild from the sources (no longer available in full)

The one-time Mongo migration (legacy config, thresholds, placements as corrections, cached ESPN leagues) was removed after the
cutover together with `legacy/`; it exists in git history (commit `70b61ed` and earlier). What can still be rebuilt from sources
on a fresh, migrated database is the Sleeper and ESPN data:

```sh
pnpm ingest all                                      # players, Sleeper seasons, NFL reference, derive
pnpm ingest espn apps/scraper/bundles/redraft-2021.json.gz
pnpm ingest espn apps/scraper/bundles/redraft-2020.json.gz
pnpm ingest nfl-reference
```

Admin settings, thresholds and corrections are only in the database, so backups (and the dump of path A) are what matter.

In the production images the same commands run as `docker compose run --rm ingest node dist/cli.js <command>`
(for example `derive`, `nfl-reference`, `sync --season redraft-2026`, `espn <bundle>`; the bundle file has to be mounted).

**Freshness:** the dump is a snapshot. Take it (and run `pnpm ingest derive` first) shortly before you start the new
server, and after the first start run Admin → Jobs → **daily** so the worker pulls anything Sleeper changed since; the
scheduled jobs then keep it current. Do not run the new site against a stale dump for long before the switch.

## 4. Production configuration (`.env`, never committed)

Copy `.env.example` to `.env` and set at least:

| Variable                                                     | Notes                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                                          | a real password                                                                                               |
| `BETTER_AUTH_SECRET`                                         | `openssl rand -base64 32`. Changing it later logs everyone out                                                |
| `PUBLIC_URL`                                                 | `https://rawfootballpotential.com` (the final address, set from the start); used for cookies and the Origin check on admin writes |
| `RFP_TAG`                                                    | an image tag: commit SHA, `latest`, or `X.Y.Z` for a `vX.Y.Z` git tag (the `v` is dropped). Automatic deploys set it for you; rollback = the previous value                                                |
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

Compare against the legacy site (still live on the old server) where it makes sense; expected differences are listed in
section 9.

**Testing the new server before the switch.** The domain still points at the old server, so reach the new one by
overriding name resolution on your own computer only: add `<new server IP>  rawfootballpotential.com www.rawfootballpotential.com`
to the hosts file (`C:WindowsSystem32driversetchosts`, edit as administrator), flush DNS (`ipconfig /flushdns`) and
restart the browser. Because `PUBLIC_URL` is already the real domain, sign-in cookies and the admin Origin check behave
exactly as they will in production, which a temporary address or bare IP would not allow. This needs the certificate for
the real domain on the new server (section 2). **Remove the hosts entry when done**, or you will keep seeing the new
server after you have switched back. Without an override you cannot tell which server answered; `/api/healthz` (which only exists on the new one) tells you.

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

## 6a. Switch the domain

1. Take a fresh dump and restore it on the new server (section 3, path A) if the earlier one is more than a day old, then
   run Admin → Jobs → **daily** once. (There is no live write path on the legacy site that the new one would miss: the
   data comes from Sleeper, which both read.)
2. Repoint rawfootballpotential.com (and www) to the new server in your DNS provider. With the short TTL most visitors
   move within minutes.
3. Remove the hosts-file entry, then confirm from a phone on mobile data (no override) that you get the new site, the
   certificate is valid, and `https://rawfootballpotential.com/api/healthz` answers.
4. Watch Admin → Jobs and `docker compose logs -f api ingest` through the next scheduled `daily` (05:00) and `finalize`.
5. **Leave the legacy server running for a few days** (it needs no changes) so you can switch back. Do not restore the old
   TTL until you are happy.

## 7. After the cutover

- [ ] After a few quiet days: shut down the old server's web app, restore a normal DNS TTL, and remove the old server from
      anything that still references it (monitors, backups).
- [x] `legacy/`, the parity harness and the Mongo migration code were deleted (history keeps them).
- [ ] Shut down Mongo and rotate its credentials (not in this repository).

## 8. Running it: what happens on its own

| Job                | When                           | What                                                                                              |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `live`             | every 5 min in NFL game windows | current week's scores for the Matchups page only (records never read live data)                   |
| `daily`            | 05:00                          | player dump (at most once a day), rosters, transactions, picks, draft, team names; then deletes record-cache rows older than 30 days |
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

- **Switch back to the legacy site:** point rawfootballpotential.com back at the old server (the DNS records you noted
  before the switch; the short TTL makes it take minutes). The legacy site was never changed, so there is nothing to
  redeploy. Anything admins entered on the new site in the meantime (corrections, thresholds) exists only there.
- **Roll back a bad release on the new server:** set `RFP_TAG` to the previous tag and `docker compose pull && docker compose up -d`. Migrations are
  not reversed (destructive changes were made two-step on purpose); the previous images keep working with the current schema.
- **A wrong number on a record page:** every record is a plain SQL query over the `rec_*` views; `pnpm --filter @rfp/api show-record <id>`
  (and `sweep-records`) print rows from a database. A season's derived data can be rebuilt without touching sources: Admin →
  Jobs → recompute (with re-normalize, it re-reads the cached raw data and re-applies corrections).
- **Restore from backup:** `pg_restore --clean --if-exists -d <url> rfp-YYYYMMDD-HHMM.dump`, then `docker compose up -d`.
- **Worker looks stuck:** `/api/healthz` shows the last successful `daily` and `finalize`; the Jobs page shows each run's log.
