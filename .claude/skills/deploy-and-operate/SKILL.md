---
name: deploy-and-operate
description: How RFP is built, released, deployed on the homelab server and kept up to date; answers "how do I deploy / roll back / back up / upgrade / check it is healthy" questions. Use for any deployment, release, server or operations question.
---

# Deploying and operating RFP

`docs/cutover.md` is the full runbook (data paths, `.env`, checklist, rollback); this is the short version.

## How a change reaches production

**Automatic (once the self-hosted runner from `docs/deploy-runner.md` is installed):** merging to `main` runs Release images, then
`.github/workflows/deploy.yml` on the server's runner: backup, `RFP_TAG` = the commit SHA, pull, up, wait for `/api/healthz`,
roll back to the previous tag if unhealthy. Manual run or rollback: Actions -> Deploy -> Run workflow with `tag`. New `.env`
variables are not managed by it: add them to `/opt/rfp/.env` before merging. The manual route follows.

1. Work on a branch, run the gate (`pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm db:check`), open a PR, merge to `main` (CI: `.github/workflows/ci.yml`).
2. A push to `main` or a `v*` tag runs `.github/workflows/release.yml`, which builds five images and pushes them to GHCR:
   `ghcr.io/zeknikz/rfp-{migrate,api,ingest,web,backup}`. Tags: full git SHA always, `latest` on main, semver on `v*` tags
   (`v1.2.0` becomes `1.2.0`; the `v` is stripped). Wait for the workflow to go green (Actions tab; `gh` may not be logged in).
3. On the server (`/opt/rfp`, created by `infra/setup-server.sh`): set `RFP_TAG` in **`.env`** (the compose file reads it
   from there; do not edit the compose file for a tag), then:

   ```sh
   cd /opt/rfp && docker compose pull && docker compose up -d
   ```

   Order is enforced: `migrate` runs the Drizzle migrations and exits 0, then `api` and `ingest` start; on start the worker
   re-derives seasons whose derive version is behind and re-registers its schedules.

4. Check: `docker compose ps`, `curl http://127.0.0.1:8080/api/healthz` (reports the DB and the last `daily`/`finalize` runs), Admin -> Jobs.

If `docker-compose.yml` itself changed (new service, env var, volume), copy the new file to the server too and add any new
variable to `.env` (compare with `.env.example`).

## What needs extra care

- **Migration:** take a backup first: `docker compose run --rm backup once`. Migrations are additive on purpose, so the previous images still run against the new schema.
- **Derive change** (`DERIVE_VERSION` bumped): the first start after deploy re-derives; watch Admin -> Jobs.
- **Changed record definition:** bump that record's `version` in the catalog; the cache key includes it, so old answers stop matching on deploy and the API pre-warms the new ones at startup. No recompute needed.
- **Rollback:** set `RFP_TAG` to the previous tag or SHA, then `docker compose pull && docker compose up -d`. Migrations are not reversed. For a data problem, restore a backup (`pg_restore --clean --if-exists`).

## One-off commands in production

```sh
docker compose run --rm ingest node dist/cli.js derive            # also: sync --season <id>, nfl-reference, espn <bundle>
docker compose run --rm -it api node dist/create-owner.js --email <e> --name "<n>"
docker compose run --rm api node dist/show-record.js <record-id> [--league dynasty] [key=value ...]   # read-only, prints top rows
docker compose run --rm api node dist/sweep-records.js [id-prefix]                                   # every record x filters, no failures expected
docker compose run --rm backup once
docker compose logs -f api ingest
```

## Background jobs (TZ America/New_York)

`live` every 5 min in NFL windows (Matchups page only); `daily` 05:00 (player dump once a day, rosters, transactions, picks,
draft); `nfl-reference` 05:30; `season-rollover` 07:00 (finds a new Sleeper season by itself); `finalize` Tue/Wed 06:00
(completes the week, recomputes derived data, bumps `data_version`, warms the cache); backups every 24 h to `./backups`
(14 days) plus S3 if set.

## Server notes

- Homelab VM (Debian/Ubuntu), Docker + compose plugin. TLS is terminated by an external reverse proxy or tunnel forwarding to `WEB_PORT` (8080); `PUBLIC_URL` must be the real https address (cookies, admin Origin check).
- Postgres is bound to 127.0.0.1 only. Secrets live only in `/opt/rfp/.env` (mode 600). Never print them.
- Off-machine backups need `S3_BUCKET`, `S3_ENDPOINT_URL`, `AWS_*` in `.env`; test a restore into a scratch DB now and then.
- OS and Docker updates: `apt update && apt upgrade`. A newer Postgres 18 minor image arrives with `docker compose pull`; a _major_ Postgres upgrade needs dump/restore, never just a tag change.

## Answering the owner

Say concretely which case above applies, give the exact commands, and name what to look at to confirm (healthz, the Jobs
page, the record page). If you have not verified something against the actual server, say so.
