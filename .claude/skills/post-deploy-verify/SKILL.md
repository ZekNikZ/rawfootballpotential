---
name: post-deploy-verify
description: Verify the live RFP site after a merge/deploy and diagnose "it is broken on the live site" reports (preload errors, empty responses, stale pages). Use after every deploy or when the owner reports a production problem.
---

# After a deploy

Quick path: run the `deploy-verifier` agent. Manual path:

1. `gh run list --limit 6`: CI, Release images and Deploy for the merge commit are green; for Deploy,
   `gh run view <id> --log | grep "healthy after"`. A red Deploy has rolled back (see its log); the site is still on the old version.
2. `curl -s https://rawfootballpotential.com/api/healthz` -> `ok: true`, sensible `lastDaily` / `lastFinalize`.
3. The front end: `/` references `assets/index-<hash>.js|css`; each must return 200 with the right content type.
4. API: `/api/site`, `/api/leagues`, `/api/leagues/redraft/records` (count, descriptions), one record.
5. If a migration shipped: the new data is visible; if `DERIVE_VERSION` was bumped: wait for the worker's re-derive (Admin -> Jobs).

## Known failure modes

- **"Unable to preload CSS/JS for /assets/X"** (or a blank lazy page): the browser holds an `index.html` from before the deploy and asks for a
  hashed chunk that the new `web` image no longer has. The app now reloads once to the page being opened (`preload-recovery.ts`) and Caddy answers a
  missing `/assets/*` file with a real 404, not the SPA page. If it still appears: `curl -I` the asset URL; a `200 text/html` means the Caddyfile
  `/assets/*` handler is not deployed; a persistent 404 for the _current_ hash means the web image and `index.html` are out of step.
- **Empty body or timeout from `curl`** once in a while: repeat the request 10-20 times and compare status/size before concluding
  anything; the path is browser -> Cloudflare/tunnel -> reverse proxy -> Caddy (`web`) -> `api`. Do not "fix" the app for a proxy fault.
- **Old numbers after a record change**: its `version` in the catalog was not bumped (the cache key includes it).
- **Deploy fails at "Check the server layout"**: the runner user cannot write `/opt/rfp/.env` or reach the Docker socket (group
  membership applies only after the runner service restarts): `docs/deploy-runner.md`.
- **Healthy but data missing**: the database was never restored/seeded on that server (`docs/cutover.md` section 3).

Report evidence (status codes, sizes, run ids), not impressions; never print `.env`.
