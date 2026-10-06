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

Checks: `pnpm turbo run lint typecheck test` (and `pnpm format:check`). Requires Node 22.18+ (images use Node 24).
