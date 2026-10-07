---
name: data-problems
description: Diagnose a wrong number on the RFP site, a stuck or failing job, a missing or mismatched player, a new season starting, or a new ESPN bundle to import. Use when data looks wrong or ingest needs attention.
---

# Data problems

## A number looks wrong

1. Identify the record id (URL or API `meta.id`) and the filters (they are in the URL).
2. `pnpm --filter @rfp/api show-record <id>` against the dev DB (or point `DATABASE_URL` at a restored copy of prod; never write to prod from a laptop).
3. Every record is a plain query over `rec_*` views: read the engine in `apps/api/src/records/engines/`, then re-derive one row by hand with SQL.
4. Check the definition in `docs/records-architecture.md` 3.11.3 first: many "wrong" numbers are a documented decision (two-week 2020 games, byes, ties, median handling, current-manager labels, bracket-based placements).
5. Stale after a code change? See `add-metric` step 7 (the cache is keyed by data version): recompute the season.
6. If the source data is wrong (score, game type, placement) on a **Sleeper** season, the owner can add a correction in Admin with a reason; it survives re-ingest. ESPN seasons are not correctable: fix the bundle or importer and re-import.

## Jobs

- Admin -> Jobs shows each run's log; `/api/healthz` shows the last `daily`/`finalize`.
- Re-run from Admin -> Jobs, or `docker compose run --rm ingest node dist/cli.js job <name>` / `derive` / `sync --season <id>`.
- Recompute with "re-normalize" re-reads cached `raw_payload` (no calls to Sleeper) and re-applies corrections.
- Sleeper errors: back off, never hammer; every response is cached in `raw_payload`.

## Players

Unmatched players land in Admin -> Players. Sleeper players match by `sleeper_id`, ESPN by `espn_id` (D/ST by
`-(16000+proTeamId)` -> team abbreviation). Fix by linking/merging in the admin, not by editing rows.

## New Sleeper season

Nothing to do: `season-rollover` picks it up. If it did not, run `pnpm ingest rollover` (or the job) and check the league ids in config.

## New ESPN season or re-scrape (desktop only)

1. Add the ids to `apps/scraper/src/leagues.ts`; `pnpm scrape:espn discover --year <y>` (headed Chrome, the owner logs in
   manually, the profile persists in `.espn-profile*`, git-ignored), then `pnpm scrape:espn --year <y>`. Read the gap report before importing.
2. Create the season in Admin if needed, then import: `pnpm ingest espn <bundle.json.gz>` or Admin -> Import (150 MB limit).
3. **Copy the bundle to the S3 bucket** (bundles are git-ignored and are the only archive). Import is in place and idempotent.
4. Odd ESPN cases are decided in doc 3.11.4 (two-week playoffs, odd team counts, trade votes, one-sided matchup = bye). A new oddity: ask the owner.

## Never

Write to Mongo; edit production rows by hand to "fix" a number; print `.env`; skip the unmatched-player queue; guess a record's semantics.
