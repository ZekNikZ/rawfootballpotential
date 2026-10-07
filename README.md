# Raw Football Potential (RFP)

Fantasy football league history and records. This is the from-scratch rewrite; the previous app lives in
[`legacy/`](legacy/) as a reference until cutover. Design: [`docs/records-architecture.md`](docs/records-architecture.md).

## Layout

| Path            | What                                                                             |
| --------------- | -------------------------------------------------------------------------------- |
| `packages/core` | domain types, metric/record definitions, pure compute                            |
| `packages/db`   | Drizzle schema, migrations, `migrate` entrypoint                                 |
| `apps/api`      | Fastify API, record compiler, response cache, auth                               |
| `apps/ingest`   | pg-boss worker: Sleeper sync, NFL reference, ESPN import, derive                 |
| `apps/scraper`  | ESPN Playwright scraper (headed, runs on a desktop)                              |
| `apps/web`      | React + Vite + Mantine frontend                                                  |
| `infra/`        | Dockerfile, Caddyfile, backup script (compose file + `.env.example` at the root) |

## Local development

```sh
cp .env.example .env        # then edit; the Mongo vars are only needed for `pnpm migrate:mongo`
docker compose up -d db     # Postgres 18 on 127.0.0.1:${POSTGRES_HOST_PORT}
pnpm install
pnpm dev                    # web (Vite), api and ingest under tsx watch
```

## Docs

- [`docs/records-architecture.md`](docs/records-architecture.md): design, definitions, record catalog, "as built" notes per milestone
- [`docs/cutover.md`](docs/cutover.md): cutover instructions, the manual verification checklist, operations
- [`docs/m4-parity-report.md`](docs/m4-parity-report.md): the legacy generators compared with the new records

## One-off commands

On a development machine: `pnpm ingest <command>` (`derive`, `sync`, `nfl-reference`, `espn <bundle>`, `report`, ...),
`pnpm admin:create-owner`, `pnpm scrape:espn --year <year>` (ESPN scraper, headed browser, you log in),
`pnpm --filter @rfp/api show-record <id>` and `sweep-records`. In the production images the same tools run as
`docker compose run --rm ingest node dist/cli.js <command>` and `docker compose run --rm -it api node dist/create-owner.js --email ... --name ...`.

Checks: `pnpm turbo run lint typecheck test` (and `pnpm format:check`). Requires Node 24 (see `.nvmrc`).
