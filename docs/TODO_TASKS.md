# Outstanding tasks

Open work noted at the end of the rewrite (2026-10-07). Roughly in priority order inside each group. Update this file as
things are done; delete finished items. "Owner" = Matthew; "Claude" = a Claude Code session can do it.

## Bugs and live-site checks

- [ ] _(hard refresh fixed it for the owner, which points to cause 1; the hardening below is still worth doing)_ **"Unable to preload CSS for /assets/ManagerRecords-DKa71XGT.css"** when navigating to the manager records page on the
      live site (reported right after the emoji-font deploy). Findings so far: the file exists and is served (`200 text/css`,
      same hash as the current build), so it is not a missing asset in the current deploy. Likely causes, in order:
      1. a tab opened **before** a deploy still runs the old `index.html`/JS, whose lazy chunks were removed when the web
         container was replaced (every deploy replaces `/assets`); or the deploy window itself;
      2. an intermittent failure in the path through the tunnel/proxy (while checking the site, a few requests returned an
         empty body or timed out once; unexplained);
      3. `infra/Caddyfile` serves `index.html` (HTTP 200, `text/html`) for **any** unknown path, including a missing
         `/assets/*` file, which makes the browser report a CSS/JS preload failure instead of a plain 404.
      Fixes to make (Claude): add a `vite:preloadError` handler in `apps/web/src/main.tsx` that reloads the page once;
      make Caddy answer 404 for `/assets/*` misses (a `handle /assets/*` with `file_server` and no `try_files` fallback);
      optionally keep the previous build's assets for a while. First ask the owner whether a hard refresh fixes it, and whether it
      repeats (curl the CSS 20 times and compare status/size to rule out the proxy).
- [x] Emoji check on the live site: all emojis look good (confirmed by the owner, 2026-10-07).
- [ ] Skim the 77 record descriptions written in `packages/core/src/records/descriptions.ts`; they were written from reading the
      code, not from running every record (Owner).

## Owner reminders (cannot be done by Claude)

- [ ] **Copy the ESPN bundles to the S3 bucket** (the only archive of the ESPN 2020/2021 data; git-ignored; also stored verbatim in the
      database's `raw_payload`, which a database backup includes, but keep the files themselves).
      - Files, on the desktop where they were scraped: `apps/scraper/bundles/redraft-2020.json.gz` and `redraft-2021.json.gz`
        (the `discovery-*.json.gz` recordings in the same folder are optional).
      - Example (AWS CLI; for Backblaze B2 / R2 / MinIO add `--endpoint-url <S3_ENDPOINT_URL>`; keep the credentials out of the repo):
        `aws s3 cp apps/scraper/bundles/redraft-2020.json.gz s3://<bucket>/rfp/espn-bundles/` and the same for `redraft-2021.json.gz`.
        Use a different prefix than the database backups (`S3_PREFIX`, default `rfp/`) so retention rules never touch them.
      - Verify: `aws s3 ls s3://<bucket>/rfp/espn-bundles/ --human-readable` shows both files, and compare checksums
        (`sha256sum` locally vs a download). Turn on bucket versioning or object lock if the provider offers it.
      - They can be re-imported at any time: `pnpm ingest espn <bundle>` or Admin -> Import. Re-scraping is not guaranteed to work later
        (ESPN may stop serving past seasons or change its API), which is why this copy matters.
- [ ] Set `S3_BUCKET`, `S3_ENDPOINT_URL`, `AWS_*` in `/opt/rfp/.env` for off-machine backups, then
      `docker compose run --rm backup once` and try a restore into a scratch database (`docs/cutover.md` section 6).
- [ ] Finish the cutover checklist in `docs/cutover.md` (manual verification, DNS switch if not done, keep the legacy server a few days).
- [x] `legacy/`, the parity harness and the Mongo migration code were removed (history keeps them).
- [ ] Shut down Mongo, remove `MONGO_*` from any `.env` copies, rotate the Mongo credentials (owner).
- [ ] Uptime monitor on `https://rawfootballpotential.com/api/healthz`.
- [ ] GitHub settings: protect `main` (require PR + the `check` job), create the `production` environment (optional reviewer),
      keep the repository private (the self-hosted runner has Docker access to the server).
- [ ] Test the deploy workflow's **rollback path** once on purpose (it has only been seen skipped).

## Cleanups and small improvements (Claude)

- [x] `RFP_TAG` wording fixed (cutover.md, setup-server.sh). A stray git tag `1.0.0` still exists on `6fbf583` (it triggers nothing; delete with
      `git push origin :refs/tags/1.0.0` if unwanted; the owner decides).
- [ ] Bump `actions/checkout@v4` (and other actions) in the workflows: GitHub warns that v4 runs on Node 20, being removed.
- [ ] `record_cache` grows: every metric-version or data-version bump leaves old rows. Add a nightly job deleting rows whose
      `version_key` no longer matches (or older than 30 days).
- [ ] `docker compose` health: add a healthcheck for `ingest` (it is only monitored through `/api/healthz` last-run times).
- [ ] The deploy workflow pulls `docker-compose.yml` from the commit but cannot add new `.env` variables; consider a check step
      that compares `.env.example` keys with `/opt/rfp/.env` and fails early with the missing names (never print values).
- [ ] The `ingest` image CLI and `create-owner` are documented; add `pnpm`-free commands for `sweep-records`/`show-record`
      against production (currently dev-only scripts).
- [x] Web bundle: every page and the whole admin area were already `lazy()` routes; the 644 kB main chunk was React + Mantine + app
      shell. React/react-router and TanStack Query now have their own long-lived chunks (`apps/web/vite.config.ts`), so the size warning is gone and
      returning visitors re-download only the small app chunk after a deploy. First-load size is unchanged (about 190 kB gzipped).

## Product ideas that were deliberately not built

- [ ] Cross-season streaks (currently per season; decided in `records-architecture.md` section 2).
- [ ] TOTP second factor for admins (optional in the design; better-auth supports it).
- [ ] Scope an admin to one league (the data model has room).
- [ ] Explain the **dynasty 2025 PF discrepancy** (0-3.5 points per team vs Sleeper's own totals, no effect on results; doc section 7).
- [ ] Emoji for Bebas Neue titles (logo and admin titles use `ff="Bebas Neue"` with no emoji fallback).
- [ ] A new ESPN season, if ever needed: `docs`/`data-problems` skill describes the desktop scrape and import.

## Housekeeping for Claude sessions

- [ ] Keep `CLAUDE.md`, `.claude/skills/*` and `docs/maintenance.md` in step with changes (they are the memory of this project).
- [ ] When adding a record, follow the `add-metric` skill (description required, version bump rules, tests, sweep).
