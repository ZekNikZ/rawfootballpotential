---
name: pre-merge-gate
description: The checks to run, and the PR/merge routine, before anything reaches main on RFP (a merge to main deploys to production). Use before opening or merging any PR.
---

# Before merging (a merge to `main` deploys to production)

1. Work on a branch from an up-to-date `main`; never push to `main` directly; never force-push.
2. The gate, all must pass (CI runs the same on GitHub-hosted runners):

   ```sh
   pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm db:check
   ```

   (`npx prettier --write <files>` fixes format. Tests need the dev Postgres container running.)

3. By change type:
   - record added/changed -> `add-metric` skill (+ `record-verifier` agent), `pnpm --filter @rfp/api sweep-records`;
   - schema/view change -> `db-migration` skill;
   - UI change -> run the API + web dev servers and `PW_CHROMIUM="C:/Program Files/Google/Chrome/Application/chrome.exe" pnpm --filter @rfp/web smoke`;
     look at the page in a real browser (screenshots with Playwright `channel: "chrome"`);
   - Dockerfile/compose/Caddyfile -> build the image or `caddy validate` (`MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/infra/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile`);
   - new `.env` variable -> add it to `.env.example`, `docker-compose.yml`, and tell the owner to set it in `/opt/rfp/.env` **before** merging.
4. Commit with the trailers from the session's attribution reminder; open the PR with `gh pr create`; wait for `gh pr checks <n> --watch`.
5. Merge only when asked (`gh pr merge <n> --merge`). Then watch Release images and Deploy (`gh run list`, `gh run watch <id>`) and
   run `post-deploy-verify`. A red Deploy has rolled back automatically.
6. Update `docs/TODO_TASKS.md`, `CLAUDE.md` and the skills if the change affects them (`docs-keeper` agent).
7. User-visible release? -> `changelog-entry` skill.

Hard rules: no secrets in commits or output; Mongo read-only; Sleeper politeness; ask before guessing what a record means.
