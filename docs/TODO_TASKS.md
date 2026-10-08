# Outstanding tasks

Open work noted at the end of the rewrite (2026-10-07). Roughly in priority order inside each group. Update this file as
things are done; delete finished items. "Owner" = Matthew; "Claude" = a Claude Code session can do it.

## Bugs and live-site checks

- [x] **"Unable to preload CSS"** after a deploy (a tab opened before it asks for chunks the new image no longer has; a hard refresh fixed it).
      Hardened: the app reloads once, straight to the page being opened (`apps/web/src/lib/preload-recovery.ts`, at most once per 30 s so a broken
      server cannot cause a loop), and Caddy now answers a missing `/assets/*` file with a real 404 (`Cache-Control: no-store`) instead of the SPA
      page (`infra/Caddyfile`). The earlier one-off empty/timeout responses seen with curl were never explained; if they recur, repeat a request 20 times
      and compare status and size before blaming the app (the `post-deploy-verify` skill).
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

- [x] `RFP_TAG` wording fixed (cutover.md, setup-server.sh); the stray git tag `1.0.0` was deleted.
- [x] Workflow actions bumped to their Node 24 majors (checkout v7, setup-node v7, pnpm/action-setup v6, docker actions v4/v6/v7).
- [x] `record_cache` pruning: the `daily` job deletes rows computed more than 30 days ago (`apps/ingest/src/jobs/prune.ts`).
- [x] `ingest` healthcheck: the worker touches `/tmp/ingest-alive` every 30 s while the database answers; compose checks its age.
- [x] The Deploy workflow fails early, naming them, when `/opt/rfp/.env` lacks a variable that `docker-compose.yml` requires.
- [x] `node dist/show-record.js` and `node dist/sweep-records.js` ship in the `api` image for read-only checks against production.
- [x] Web bundle: every page and the whole admin area were already `lazy()` routes; the 644 kB main chunk was React + Mantine + app
      shell. React/react-router and TanStack Query now have their own long-lived chunks (`apps/web/vite.config.ts`), so the size warning is gone and
      returning visitors re-download only the small app chunk after a deploy. First-load size is unchanged (about 190 kB gzipped).

## Records pages (owner request, 2026-10-07)

- [x] Sticky table headers, a sticky section tab bar with scroll-spy, "Back to top" links, a record picker with one-line summaries, sortable columns (server-side) and the high/low records folded together; section names reworked (`records-architecture.md` section 3.11.3).
- [ ] **Tier 2 merges** (same engine, different sort column, e.g. one "Team seasons" table for PF/PA/wins/losses/win %/lineup IQ, one table per manager section, `potential`/`actual`/`ratio` as one "Lineup efficiency" table). Not done: waiting for the owner's go-ahead.
- [ ] Entity columns (team, manager, opponent) are not sortable (resolved after the query). Sorting them would need the names in SQL.
- [ ] Old shared links with section-prefixed URL params (`single-week-scores.rec=...`) are not redirected; record ids still resolve in the API through `RECORD_ALIASES`.
- [ ] Optional: a Version History entry announcing sortable tables and the new section names (`changelog-entry` skill).
- [ ] The "Players" tab (moving player-related Overall records into their own page) was dropped for now; the section renames cover it.

## Product ideas that were deliberately not built

- [x] **Power rating** built as `career.power` and revised on 2026-10-07 (half margin, zero-sum medians in all seasons, 1.5x playoff wins and toilet-bowl losses, consistency and placement adjustments, 25% blend with average weighted placement, dynamic 1500 / 250-per-sd scale; see `docs/records-architecture.md` section 3.11.3). Tried and dropped because they barely moved anything: new managers starting at the league average, a first-season boost. Candidate follow-ups: a Version History entry announcing the power rating and the point-differential records; a regular-season-only variant; a "±" or minimum-games note for one-season managers; an all-play Elo.
- [x] **Point differential records** (`career.diff.avg/min/max/stddev`) and a placement-over-time chart on the managers page.

- [ ] Cross-season streaks (currently per season; decided in `records-architecture.md` section 2).
- [ ] TOTP second factor for admins (optional in the design; better-auth supports it).
- [ ] Scope an admin to one league (the data model has room).
- [ ] Explain the **dynasty 2025 PF discrepancy** (0-3.5 points per team vs Sleeper's own totals, no effect on results; doc section 7).
- [ ] Emoji for Bebas Neue titles (logo and admin titles use `ff="Bebas Neue"` with no emoji fallback).
- [ ] A new ESPN season, if ever needed: `docs`/`data-problems` skill describes the desktop scrape and import.

## Housekeeping for Claude sessions

- [ ] Keep `CLAUDE.md`, `.claude/skills/*` and `docs/maintenance.md` in step with changes (they are the memory of this project).
- [ ] When adding a record, follow the `add-metric` skill (description required, version bump rules, tests, sweep).
