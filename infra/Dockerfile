# syntax=docker/dockerfile:1
# One multi-target Dockerfile for the whole monorepo. Targets: migrate, api, ingest, backup, web.
# (The ESPN scraper is not containerized; it runs headed on a desktop. See docs §5.)
# Build context = repo root.
#
# Each deployable package lists its runtime files in package.json "files" (e.g. db: ["dist", "migrations"]).

ARG NODE_VERSION=24

# ---------- build ----------
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build
# Prune each deployable to its production dependency closure.
RUN pnpm deploy --legacy --filter=@rfp/db     --prod /out/db \
 && pnpm deploy --legacy --filter=@rfp/api    --prod /out/api \
 && pnpm deploy --legacy --filter=@rfp/ingest --prod /out/ingest

# ---------- node runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production
WORKDIR /app
USER node
ENTRYPOINT ["/sbin/tini", "--"]

FROM runtime AS migrate
COPY --from=build --chown=node:node /out/db .
# Applies committed SQL migrations via drizzle-orm's migrator (no drizzle-kit at runtime).
CMD ["node", "dist/migrate.js"]

FROM runtime AS api
COPY --from=build --chown=node:node /out/api .
EXPOSE 8000
CMD ["node", "dist/server.js"]

FROM runtime AS ingest
COPY --from=build --chown=node:node /out/ingest .
CMD ["node", "dist/worker.js"]

# ---------- backup (pg_dump + optional S3 upload) ----------
FROM postgres:18-alpine AS backup
RUN apk add --no-cache aws-cli
COPY infra/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]

# ---------- web (static SPA + reverse proxy) ----------
FROM caddy:2-alpine AS web
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
