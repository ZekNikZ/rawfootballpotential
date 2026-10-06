# RFP Records Rewrite — Review & Target Architecture

_Status: agreed direction, 2026-10-02. This doc is the input for the from-scratch API + UI rewrite._

## Goals

1. **Load times:** a record table should paint in well under a second, with no full-league downloads and no client-side computation.
2. **Flexibility:** any filter combination, new filters, and new kinds of records (player, transaction, draft, luck, streak) without reworking the data model.
3. **One pipeline** for Sleeper leagues and cached ESPN ("db") leagues. Assume ESPN leagues have everything a Sleeper league would.

---

## 1. Review of the current implementation

### 1.1 How it works today

- On page load, `ui/providers/global-data.tsx`:
  1. fetches the config,
  2. fetches **every league season one at a time** (`await` in a loop),
  3. fetches the full NFL player dump (about 5MB),
  4. computes **every record for every league** on the browser's main thread.
- For Sleeper seasons, `GET /leagues/:id` rebuilds the league **live from Sleeper on every request**: league, users, rosters, ~17 matchup calls, and projections (projections are cached in Mongo).
- `GET /nfl` calls Sleeper's `players/nfl` on every request. Sleeper asks callers to hit it at most once a day.
- The `cache` option in `utils/api.ts` is never passed, so nothing is cached client-side.

### 1.2 How records are defined

- `utils/record-definitions.ts` holds `RECORD_DEFINITIONS`: categories → records, each with a `generateRecord(rd, leagueDef, leagues, nflData)` closure that returns `FantasyRecord<T>` (columns plus **all entries**).
- Filtering is done by **pre-generating every combination** and tagging each entry with `league?`, `scope?` and `medianMethod?`. `RecordTable.tsx` then filters client-side.
  - Manager standings generate managers × 3 scopes × 4 median methods × (seasons + 1) entries.
  - Every new filter multiplies that again.
- Each record in a category does the same full pass, and only the sort differs. The six standings records repeat identical work, and `optimizeScore` runs about 10 times per team-game (6 potential-points records, 3 lineup records, trophies).
- Entries contain **pre-formatted strings** (`"Team (Manager)"`, `"120.50 - 98.10 (Δ 22.40)"`), so the UI can't link to, sort by or filter on their parts.

### 1.3 Filters don't mean the same thing everywhere

| Filter | Single-game records | Manager records |
|---|---|---|
| Season "All" | no filter applied | entries with `league === undefined` (pre-aggregated) |
| Scope values | `in-season` / `playoffs` / `toilet-bowl`; the UI builds "postseason" itself | `undefined` / `in-season` / `postseason`; playoffs and toilet bowl can't be split |
| Median | n/a | only the standings records support it |

`RecordTable` guesses which convention applies from `hasNullLeague`, `hasNullScope` and `hasPostseasonScope`.

### 1.4 Correctness issues (write tests for these in the rewrite)

1. **Postseason plus medians mixes in regular-season games.** In `managerCareerStandingsRecord`, median wins are added without checking scope, so "Postseason + Include medians" counts regular-season median wins.
2. **Ties count as a win for team 2.** Every file uses `team1.points > team2.points`. The median comparison uses `>=`, so a score equal to the median counts as a win.
3. **Season trophies are computed wrong** (`utils/trophies.ts`):
   - `pointsFor` only adds the winner's score.
   - `pointsAgainst[loser]` adds the loser's *own* score.
   - Both include playoff weeks.
4. **"Years in league" ignores the season filter.** It always shows the career total.
5. **Median streaks are inconsistent.** "Include medians" streaks ignore median results; median results only feed the "only medians" streaks.
6. **Playoff vs. toilet bowl is a guess.** It's decided by `week >= playoffWeekStart` plus whether team 1 is in `playoffQualifiedTeams`. For Sleeper, that list is rebuilt by sorting the *current* roster `settings.wins`. Brackets are never read, so placement games can't be identified.
7. **Possible fake games in playoff weeks (needs checking).** Sleeper's docs don't say what `matchup_id` is for teams with no game. If it's `null`, `groupBy(matchup_id)` puts every idle team into one "matchup", and the code treats the first two as a real game.
8. **Optimal lineups use today's player positions.** They read `nflPosition` from the *current* player dump, not what the player was eligible for that week, and ignore multi-position eligibility (`fantasy_positions`).
9. **Manager lookups assume one manager per team per season.** The reverse lookup is an `Object.keys(...).find` scan inside hot loops, and there's no concept of co-managers, owner changes or franchises.
10. Sleeper brackets, transactions and drafts are `"NOT IMPLEMENTED"` casts.

### 1.5 The main takeaway

Most of the slowness comes from *how data is loaded*, not from where the math runs:
- live Sleeper rebuilds on every request,
- league seasons fetched one at a time,
- a 5MB player dump shipped to the browser,
- every filter combination computed before the first paint.

The data is small: about 10 seasons × 17 weeks × 12 teams ≈ 2k team-games, and a few hundred thousand player-games. Postgres can aggregate and rank that at request time in milliseconds.

---

## 2. Decisions

| Topic | Decision |
|---|---|
| **Head-to-head ties** | Stored as `T`. Win % = (W + 0.5·T) / games played. A tie ends both a win streak and a loss streak. No tiebreaker: it would make our standings disagree with the platforms' official ones. |
| **Median game** | Compared against the **true median** of all teams' scores that week (the middle score; the average of the two middle scores when the team count is even). It doesn't depend on head-to-head results. |
| **Median ties** | A score exactly equal to the median is a **tie** (`T`), same as head-to-head. |
| **Median scope** | Median games exist only in regular-season weeks. |
| **Streaks** | **Per season** by default. A cross-season streak is a separate, later record (`streakAcrossSeasons` param, same query). |
| **Entity** | Records follow the **franchise**. Displayed manager: that season's manager when the record covers one season (a single game or a season total); the franchise's **current** manager (most recent season) when it spans several seasons. |
| **Redraft franchises** | Franchise = manager. Same person means same franchise, and a new person means a new franchise. |
| **Dynasty franchises** | Dynasty only exists on Sleeper (no ESPN dynasty leagues). The model still supports any configuration: the season-to-franchise mapping is explicit config, seeded from Sleeper's `previous_league_id` + `roster_id`. |
| **Postseason scopes** | **Follow the bracket.** Winners-bracket games, *including placement games* (3rd, 5th, …), are `playoffs`. Losers-bracket games, including their placement games, are `toilet_bowl`. `postseason` = both. Each game also stores `placement_at_stake` and `is_championship`, so filters like "championship only" or "exclude placement games" can be added later. |
| **Seasons without a losers bracket** | Playoff-week games with no bracket entry are marked `game_type = 'none'`: kept in the data but **left out of every scope**. Ingestion will report what the source actually contains for those weeks. |
| **Scope filter** | The same 5-way filter everywhere a record is scope-aware: All / Regular / Playoffs / Toilet bowl / Postseason. |
| **Player season totals** | Only the weeks the player was **rostered in the league**, scored with that season's league scoring. A player can contribute to more than one team in a season. No full NFL stat pull. |
| **"Bye week" scores** | A team's score in a week with **no counted game** (playoff bye, eliminated, no bracket game), plus the best player on that roster that week. Stored as `team_week` rows with `counts = false`. |
| **Drafted-player retention** | The player is on the **team that drafted him in the final week of the season**. Traded or dropped = no, even if he was re-acquired later; that's checked with `player_tenure` (one continuous stint from draft to final week). |
| **Waiver claims** | Only **successful** claims count. Failed claims are stored but never counted. Whether free-agent adds count is decided **per record**: each transaction record's definition says which transaction types it includes (`txTypes: ["waiver"]` or `["waiver", "free_agent"]`). It's not a user filter. "$ spent" = winning FAAB bids. |
| **Trade size** | "Largest trade" = number of distinct **players** moved. Picks and FAAB don't count, but are shown as extra columns. "Broadest" = number of distinct teams. |
| **Most moved player** | Number of distinct completed transactions involving the player. A trade = 1 and a drop = 1; another team then adding him = 1 more. Example: dropped by A, claimed by B, traded to C = 3. |
| **Live data in records** | Records only read **completed weeks**. Each record declares whether a partial in-progress season counts (see §3.3). |

---

## 3. Target architecture

### 3.1 Three tiers of computation

```
 Sleeper API ─┐                         ┌─> derived facts ─┐
              ├─> raw ─> normalize ─────┤                  ├─> record query (SQL, filters) ─> cache ─> API ─> UI
 ESPN scrape ─┘   (jsonb)  (canonical)  └──────────────────┘     keyed by (record, params, data_version)
```

1. **Ingest time (TypeScript, once per sync):** normalize source data into the canonical schema. Then compute the expensive *per-row* facts once:
   - optimal lineup,
   - game type from the brackets,
   - weekly median and median results,
   - all-play results,
   - weekly rank and z-score,
   - projected points.
2. **Query time (SQL):** each record compiles to a query over those facts that takes filter parameters. Any filter combination works, and new filters are just a new `WHERE`. No backfill is ever needed.
3. **Cache:** responses are keyed by `(record_id, normalized params, data_version)`. Data only changes when a sync runs, so invalidation is simply bumping the `data_version` of the affected season. Completed seasons never change, so their cached results survive live in-season updates. Default filter combinations are pre-warmed after each sync. Responses carry an `ETag` plus `Cache-Control`.

**We deliberately do not store a fully precomputed table for every filter combination.** That repeats today's combinatorial blow-up on the server, and every new filter multiplies it.

### 3.2 Schema (Postgres)

**Raw layer:** source payloads stored as-is, so we can re-normalize without re-fetching. Scraped ESPN data is irreplaceable.

```
raw_payload       id, source (sleeper|espn), endpoint, params jsonb, fetched_at, payload jsonb
```

**Canonical layer**

```
league              id, slug, name, type (redraft|dynasty), color
league_season       id, league_id, year, source, external_id,
                    status (pre_draft|drafting|in_season|post_season|complete),
                    regular_season_weeks, playoff_week_start, playoff_teams,
                    median_enabled, has_losers_bracket,
                    roster_slots text[], bench_slots, ir_slots, taxi_slots,
                    scoring_settings jsonb, waiver_type (normal|faab), faab_budget,
                    has_player_data, has_projections, has_transactions, has_draft,
                    has_faab, has_auction_draft,                -- drive [D]-only records
                    last_completed_week                         -- denormalized from league_season_week
league_season_week  league_season_id, week, status (upcoming|in_progress|complete),
                    game_type_default, finalized_at             -- records only read status = complete
league_threshold    league_id, key (high_scorer|benchwarmer|smartypants|...), value
                    -- e.g. redraft high_scorer 190, dynasty 200; per-season override optional
manager             id, name, avatar
manager_identity    manager_id, source, external_user_id          -- Sleeper user ids, ESPN SWIDs
franchise           id, league_id, name?                          -- redraft: 1 per manager
team_season         id, league_season_id, franchise_id, external_roster_id,
                    name, avatar, division, seed, final_place, made_playoffs
team_season_manager team_season_id, manager_id, role (primary|co), from_week?, to_week?
matchup             id, league_season_id, week,
                    game_type (regular|playoffs|toilet_bowl|none),
                    bracket (winners|losers|null), bracket_round,
                    placement_at_stake int?, is_championship bool
team_week           id, league_season_id, team_season_id, week,
                    matchup_id?, opponent_team_season_id?,       -- null = no game (playoff bye / eliminated)
                    counts bool,                                 -- false for no-game weeks and game_type 'none'
                    points, points_overridden, result (W|L|T)?, margin?,
                    is_final bool                                -- live scores update until the week completes
player              id, sleeper_id, espn_id, full_name, position, fantasy_positions text[],
                    nfl_team, injury_status, ...                 -- *current* info; Sleeper's dump has espn_id
player_week         team_week_id, player_id, slot (QB|RB|...|FLEX|BN|IR|TAXI), is_starter,
                    points, projected_points,
                    position, eligible_positions text[],         -- snapshot for that week, never "today's"
                    nfl_team, nfl_game_id?,                      -- the player's NFL team *that week*; null game = bye
                    nfl_status (active|inactive|reserve|...)?    -- from nflverse weekly rosters (§3.8)
roster_current      team_season_id, player_id, slot, acquired_via, acquired_at
                    -- live roster for the Teams/Rosters pages, also in the offseason
transaction         id, league_season_id, type (trade|waiver|free_agent|commissioner),
                    status (complete|failed), week, executed_at, waiver_priority?
transaction_item    transaction_id, kind (player|pick|faab), direction (add|drop|move),
                    player_id?, pick ref?, amount?, faab_bid?,
                    from_team_season_id?, to_team_season_id?
draft               id, league_season_id, kind (startup|rookie|redraft), type (snake|auction|linear),
                    status (pre_draft|drafting|complete), rounds, started_at
draft_pick          draft_id, pick_no, round, slot, team_season_id, player_id, amount?, is_keeper
traded_pick         league_id, season, round, original_franchise_id, owner_franchise_id,
                    as_of                                        -- Future Picks page (dynasty)
nfl_state           season, week, season_type, updated_at        -- Sleeper /state/nfl, decides "current week"
nfl_game            id, season, week, game_type (REG|POST), kickoff, home_team, away_team,
                    home_score?, away_score?, status              -- §3.8
nfl_team_week       season, week, nfl_team, nfl_game_id?, is_bye  -- derived: one row per team per week
nfl_player_week     season, week, player_id, nfl_team, status     -- nflverse weekly rosters (§3.8)
player_id_map       player_id, sleeper_id, espn_id, gsis_id, ...  -- dynastyprocess crosswalk + manual fixes
```

**Derived layer:** separate tables, so a recompute can wipe and refill them without touching ingested data.

```
team_week_stats     team_week_id, optimal_points, bench_points, ir_points, projected_points,
                    lineup_iq, is_perfect, week_median, week_mean, week_rank, week_zscore,
                    allplay_w, allplay_l, allplay_t, top_player_share
game_result         team_season_id, franchise_id, league_season_id, week, seq,
                    kind (h2h|median), opponent_team_season_id?, result (W|L|T),
                    game_type, points_for, points_against
team_season_week    team_season_id, week, wins, losses, ties, pf, pa, rank, games_back,
                    clinched?, eliminated?                       -- standings after each week (Standings page,
                                                                 -- "first place after week N", history charts)
player_tenure       player_id, team_season_id, from_week, to_week, acquired_via, left_via
                    -- continuous stints on a roster; powers draft retention, most moved, loyalty, trade value
sync_run            id, kind (live|daily|finalize|backfill), league_season_id?, started_at,
                    finished_at, status, log
data_version        league_season_id, version                    -- per season, so live in-season updates
                                                                 -- don't invalidate cached history
record_cache        record_id, params_hash, version_key, payload jsonb, computed_at
                    -- version_key = hash of the data_versions of the seasons the query touched
```

`game_result` is the key table. The median is a **pseudo-opponent row** (`kind = 'median'`), so:
- every median filter is just a `WHERE` on `kind`:
  - `include`: both kinds
  - `exclude`: `h2h` only
  - `only`: `median` only
  - `default`: median rows only where `league_season.median_enabled`
- wins, losses, win % and streaks all handle medians the same way automatically,
- streaks are window functions over `ORDER BY week, seq`, partitioned by `(franchise_id, league_season_id)` (cross-season: drop `league_season_id` from the partition).

### 3.3 Record engine: metric × grain × direction

Today's categories (`overall`, `single-season`, `manager`) are really **grains**. "Highest score", "most points in a season" and "most career points" are the same metric (`sum(points)`) at different grains.

**Grains**

| Grain | Row = | Example records |
|---|---|---|
| `team_week` | one team in one week (`counts = true` unless the record asks otherwise) | highest score, largest blowout, best lineup IQ, best score that didn't count |
| `matchup` | both teams in one game | highest combined score, closest championship |
| `league_week` | the whole league in one week | highest weekly median |
| `team_season` | franchise × season | most PF in a season, worst champion, best team to miss the playoffs |
| `franchise_career` | franchise across seasons | career wins, win %, championships, average placement |
| `player_week` | player on a roster in one week | best player performance, biggest bench miss |
| `player_season` | player × season (weeks rostered in the league) | season player score, PPG, biggest benchwarmer |
| `transaction` | one transaction | biggest trade, highest FAAB bid, best pickup |
| `draft_pick` | one pick | best value pick, biggest bust |

**Definitions**

These definitions live in `packages/core`, and the API compiles them to SQL:

```ts
export const metrics = {
  points:    { agg: sum("tg.points"), format: "points" },
  margin:    { agg: sum("tg.margin"), format: "points" },
  optimal:   { agg: sum("s.optimal_points"), format: "points", requires: ["playerData"] },
  lineupIQ:  { agg: ratio(sum("tg.points"), sum("s.optimal_points")), format: "pct", requires: ["playerData"] },
  wins:      { agg: countWhere("gr.result", "W"), source: "game_result" },
  winPct:    { agg: winPct("gr"), source: "game_result", qualifier: { minGames: 10 } },
  // ...
};

defineRecord({
  id: "points.high",
  title: { team_week: "Highest score", team_season: "Most points in a season", franchise_career: "Most career points" },
  metric: "points",
  grains: ["team_week", "team_season", "franchise_career"],
  direction: "desc",
  filters: ["seasons", "scope", "weeks", "franchise", "opponent"],
  columns: ["entity", "when", "opponent", "metric"],
});

defineCustomRecord({ id: "streak.win", grain: "franchise_career", query: (db, p) => winStreakQuery(db, p) });
```

**Rules**
- Ratio metrics are always `sum/sum`, never an average of per-game ratios.
- Ranking uses `RANK()`, so ties share a position.
- `qualifier` (e.g. minimum games) is enforced in SQL and reported in the response.
- `requires` is checked against the `has_*` flags on each league season. The response reports which seasons were included ("data available from …").
- A `custom` escape hatch covers records that don't fit: gaps-and-islands streaks, schedule swaps, transaction attribution.
- **Record holders, not just values.** When several seasons or weeks share the best value, aggregate metrics return every occurrence (e.g. longest loss streak `10 (2021, 2023)`, highest placement `2 (2024)`). That uses `array_agg` over the argmax set.
- **Completed weeks only.** Every record query reads through `rec_*` views that keep only rows where `league_season_week.status = 'complete'` and `team_week.is_final`. In-progress weeks never reach a record.
- **Active-season policy:** each record declares one:
  - `include`: partial seasons are fine. Examples: single-week records, career totals, most points in a season so far.
  - `complete_only`: the in-progress season is left out until it finishes. Examples: lowest season PF/PA, fewest wins, placements, playoff and toilet bowl appearances, draft retention %, lowest trade/claim counts. Without this, a half-finished season would "win" every *lowest* record.
  - `flag`: included, but the row is marked as in progress in the UI. Example: highest season PF so far.

### 3.4 Filters: one typed, validated query object

```ts
interface RecordQuery {
  seasons: "all" | number[] | { from: number; to: number };
  scope: "all" | "regular" | "postseason" | "playoffs" | "toilet_bowl";
  median: "default" | "include" | "exclude" | "only";   // only on W/L metrics
  weeks?: { from: number; to: number };
  franchise?: FranchiseId;
  opponent?: FranchiseId;
  onePer?: "season" | "franchise";     // "season max": keep only the best row per season (or per franchise)
  // player records
  positions?: Position[];              // the player's position *that week* (player_week.position)
  slots?: ("starter" | "bench" | "ir" | "taxi")[];
  excludeZero?: boolean;               // "non-zero" lowest scores
  // team-week records
  countedOnly?: boolean;               // default true; false includes byes and eliminated weeks
  divisionOnly?: boolean;
  championshipOnly?: boolean;          // future
  excludePlacementGames?: boolean;     // future
  streakAcrossSeasons?: boolean;       // future, default false
  minGames?: number;
  limit: number; offset: number;
}
```

- Validated with zod on the API side.
- Each record declares which filters it supports. The catalog endpoint returns that list, so the UI builds its filter controls from metadata instead of guessing.
- **Your list's tags map onto this.**
  - `[AT/S]` = the `seasons` filter.
  - `[S/P/B]` = the full `scope` filter: All / Regular / Playoffs / Toilet bowl / Postseason.
  - `[R/D]` / `[D]` are not hardcoded per league. They come from `requires` (`faab`, `auctionDraft`) checked against `has_faab` / `has_auction_draft`, so a record shows up in any league whose data supports it.
  - On single-season records, the season is a **column**. `[AT]` means seasons default to `all`, and `onePer: "season"` is the "season max" toggle.
- **Scope for transactions:** a transaction's scope comes from the week it happened. For trades it's that week's game type. For a single team's claims it's that team's `team_week`, so a toilet bowl team's playoff-week pickup counts as toilet bowl.

### 3.5 API (REST, so responses cache well)

```
GET  /api/leagues                                    leagues, seasons, data availability
GET  /api/leagues/:league/records                    catalog: id, title, grain, filters, columns, availableFrom
GET  /api/leagues/:league/records/:id?grain=team_week&seasons=2024&scope=playoffs&median=default&limit=25
     → { meta, params (normalized), rows: [{ rank, values, refs: { franchiseId, managerId, teamSeasonId, matchupId } }],
         total, entities: { franchises, managers, teamSeasons }, dataVersion, availableFrom }
GET  /api/leagues/:league/h2h?seasons=&scope=&median= franchise × franchise matrix
GET  /api/leagues/:league/trophies?season=
GET  /api/leagues/:league/franchises/:id              profile: summary + per-record standings

# Info pages (may include in-progress weeks; short cache for the active season)
GET  /api/seasons/:seasonId/standings?week=           team_season_week
GET  /api/seasons/:seasonId/matchups?week=            team_week + player_week (live while in progress)
GET  /api/seasons/:seasonId/teams                     divisions, team_season, roster_current
GET  /api/seasons/:seasonId/transactions?type=&team=  transaction feed
GET  /api/leagues/:league/picks                       traded_pick (dynasty)
GET  /api/seasons/:seasonId/draft                     draft board

# Admin (auth required, never cached; see §3.9)
POST /api/auth/*                                      better-auth: sign in / out, session
GET|PUT /api/admin/{site,leagues,seasons,managers,franchises,thresholds,records}
GET|POST|DELETE /api/admin/overrides                  data corrections
GET|POST /api/admin/players/unmatched                 ID mapping queue
POST /api/admin/jobs/:job?leagueSeasonId=             live | daily | finalize | nfl-reference | recompute
GET  /api/admin/jobs/runs                             sync_run history
GET|POST|PATCH /api/admin/users, /api/admin/invites   owner only
GET  /api/admin/audit
POST /api/admin/import/espn                           upload an ESPN season bundle (§5)
```

- Rows contain **typed values and entity references, not formatted strings**. The UI formats them and can link to franchise, game and season pages.
- `managerId` in `refs` follows the manager display rule in §2.

### 3.6 Stack and repo layout

```
packages/core     domain types, record/metric definitions, pure compute (optimal lineup,
                  medians, all-play, bracket classification) — fully unit-tested
packages/db       Drizzle schema, migrations, query helpers (window functions via sql``)
apps/api          Fastify (or Hono) + zod; record compiler; response cache
apps/ingest       Sleeper sync, NFL reference data, ESPN bundle import, normalize → derive jobs (pg-boss)
apps/scraper      ESPN Playwright scraper, runs headed on a desktop and outputs season bundles (§5)
apps/web          React + Vite + TanStack Query; URL search params own filter state; Mantine
```

- **Pipeline order:** raw → normalize → derive → bump that season's `data_version` → pre-warm cache.
- **Web:** each record table fetches its own ~25 rows when it's shown. Nothing loads the whole league.

### 3.7 Active (current) season support

The active season goes through the same tables as history. "Current" is just a season whose `status` isn't `complete` and whose weeks aren't all `complete`. There's no separate live schema to keep in sync.

**Sync jobs (`apps/ingest`)**

| Job | When | What it does |
|---|---|---|
| `live` | every few minutes during NFL game windows, active season only | refreshes `team_week` / `player_week` points for the current week (`is_final = false`). Live scores feed the Matchups page only. |
| `daily` | once a day | `players/nfl` (current player info), `/state/nfl`, rosters → `roster_current`, transactions, traded picks, draft (if drafting), team names and avatars |
| `finalize` | when `/state/nfl` moves past a week and scores are final (Tuesday morning; can be re-run if stat corrections arrive) | marks the week `complete`, sets `is_final`, recomputes the season's derived tables (`team_week_stats`, `game_result`, `team_season_week`, `player_tenure`), bumps the season's `data_version`, pre-warms caches |
| `nfl-reference` | daily in season; once for backfill | NFL schedule → `nfl_game` / `nfl_team_week`, nflverse weekly rosters → `nfl_player_week`, ID crosswalk → `player_id_map`; then fills `player_week.nfl_team / nfl_game_id / nfl_status` |
| `season-rollover` | when Sleeper creates the next season | creates `league_season` (via `previous_league_id`), team seasons and the franchise mapping (redraft: by manager; dynasty: by roster) |

**What each info page reads**

| Page | Data |
|---|---|
| Home | current standings (`team_season_week`, latest week), current week's matchups, recent transactions |
| Standings | `team_season_week` (any week; also standings history), divisions, playoff seeds, clinched/eliminated |
| Matchups | `team_week` + `player_week` for any week, live while in progress, with projections |
| Teams → Divisions / Rosters | `team_season` + `roster_current` + `player` (injury, NFL team) |
| Transactions → Trades & Waivers | `transaction` + `transaction_item` feed, filterable |
| Transactions → Future Picks | `traded_pick` (dynasty) |
| Draft | `draft` + `draft_pick` (live while drafting) |
| Records / Trophies | `rec_*` views (completed weeks only) |

**Rules**
- Team names and avatars only exist as "current" in Sleeper. They're overwritten daily while a season is active and frozen once it completes.
- Projections are stored per `player_week` for every week, including the upcoming one, so the Matchups page can show projected scores.
- Info pages may read in-progress weeks. **Records never do** (§3.3).

### 3.8 NFL reference data (bye weeks, NFL teams, inactives)

None of the fantasy APIs give a clean historical "which NFL team was this player on, and was that team on bye" per week. Sleeper's player dump only has *current* teams. Three free sources cover it. I checked each one on 2026-10-05:

| Source | What it gives | Use |
|---|---|---|
| **nflverse `games.csv`**: `https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv` | every NFL game since 1999: `season, game_type, week, gameday, away_team, home_team, scores, …` | **Primary schedule.** A bye = an NFL team with no game in a REG week. One file, all history. |
| **nflverse weekly rosters**: `https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{season}.csv` | per season and week: `team, position, status, sleeper_id, espn_id, gsis_id, …` | The player's **NFL team that week** and **active/inactive status**. Includes `sleeper_id` + `espn_id`, so it joins straight to our players. |
| **Sleeper schedule** (undocumented): `https://api.sleeper.app/schedule/nfl/regular/{season}` | `week, home, away, date, status` per game | **Live-season** cross-check and game status. Undocumented, so it's a fallback, not the source of truth. |
| **dynastyprocess ID crosswalk**: `https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv` | `sleeper_id, espn_id, gsis_id, yahoo_id, …` | Seeds `player_id_map`, mainly for matching ESPN player IDs. |

**How it flows**
1. `nfl_game` ← `games.csv`. `nfl_team_week` is derived as 32 teams × weeks, with `is_bye` = no game that week.
2. `nfl_player_week` ← weekly rosters, keyed through `player_id_map`.
3. `player_week.nfl_team` comes from `nfl_player_week`. For weeks it's missing, fall back to the `team` field on Sleeper's per-week projections/stats payload, which we already fetch. `player_week.nfl_game_id` comes from `nfl_team_week`, so a null game means that player was on bye.
4. Team defenses (`DEF` / `D/ST`) map to their NFL team directly.

**Caveats**
- Old seasons in weekly rosters are thinner. Inactive status is reliable from the early 2000s on, which covers all our seasons.
- Team abbreviations changed over time (`OAK`→`LV`, `SD`→`LAC`, `STL`→`LA`, `WAS` naming). We need a small alias table so all sources agree.

### 3.9 Admin UI and configuration

Today, config is a hand-edited Mongo document. In the rewrite, **config is Postgres tables edited through a password-protected admin UI**, and every change is audited.

**Auth**
- **Library:** [better-auth](https://www.better-auth.com) with its Drizzle adapter, email + password, and the admin plugin for roles. That way we don't hand-roll password hashing or sessions.
- **Sessions:** server-side session tables, stored in httpOnly + Secure + SameSite=Lax cookies.
- **Requests:** an Origin check on mutating requests, and rate limiting on login.
- **Sign-up is disabled.** Admins only get in by invite.
- **Bootstrap:** the first owner is created by a CLI command (`pnpm admin:create-owner`).
- **No email service needed.** Invites and password resets produce a one-time link the owner shares directly.
- **Optional:** TOTP two-factor, via a better-auth plugin.

**Roles**

| Role | Can |
|---|---|
| `owner` | everything below, plus invite, disable and remove admins and change their roles |
| `admin` | edit config, fix data, run syncs and recomputes |

There's room to scope an admin to specific leagues later (`admin_user_league`) without changing the model.

**What the admin UI manages**

| Area | Config |
|---|---|
| Site | name, short name, changelog / announcements (moves out of `utils/changelog.ts`) |
| Leagues | name, slug, type, color, display order |
| League seasons | add a season (source + external ID), enable/disable, override `has_*` data flags |
| Managers | names and avatars, linked identities (Sleeper user IDs, ESPN SWIDs), merge duplicate managers |
| Franchises | season-to-franchise mapping (dynasty), franchise names |
| Results | final placement overrides, bracket / `game_type` corrections, score overrides (with a required reason) |
| Thresholds | `league_threshold` values (High Scorer's / Benchwarmer's / Smartypants …) |
| Players | unmatched-player queue (ESPN / nflverse IDs without a match), manual ID mappings |
| Records | show/hide, order, featured, per-league enable |
| Data jobs | trigger `live` / `daily` / `finalize` / `nfl-reference` / recompute; view `sync_run` history and logs |
| Admins (owner only) | invite, reset password, disable, change role |

**Corrections must survive re-ingest.** Manual fixes don't edit ingested rows directly. They go in an `override` table that the normalize step applies, so pulling a season from Sleeper or ESPN again never wipes a correction.

**Schema additions**

```
admin_user          id, email, name, role (owner|admin), disabled, created_at, last_login_at
admin_session       id, user_id, expires_at, ip, user_agent             -- managed by better-auth
admin_account       user_id, password_hash, ...                          -- managed by better-auth
admin_invite        id, token_hash, role, created_by, expires_at, used_at
site_config         key, value jsonb
record_config       league_id?, record_id, visible, sort_order, featured
override            id, entity (team_week|matchup|team_season|player_map|...), entity_id,
                    field, value jsonb, reason, created_by, created_at, active
audit_log           id, user_id, action, entity, entity_id, before jsonb, after jsonb, at
```

**Flow:** save in UI → `PUT /api/admin/...` (zod-validated, role-checked) → write config/override + `audit_log` → if it affects derived data, queue a recompute for the affected seasons → bump their `data_version` → caches refresh.

**UI:** `/admin/*` lives in the same web app as a lazy-loaded chunk behind an auth guard, so public visitors never download it. Forms use Mantine form with the zod schemas from `packages/core`. Admin endpoints are under `/api/admin/*` and are never cached.

### 3.10 Infrastructure

Files: `docker-compose.yml` and `.env.example` at the repo root, `infra/` (multi-target `Dockerfile`, `Caddyfile`, `backup.sh`) and `.github/workflows/` (CI + image release), all on the **`rewrite` branch** of this repo. The current site keeps running from `main` until cutover.

**Containers (one machine)**

| Service | Image | Role |
|---|---|---|
| `db` | `postgres:18-alpine` | data. Port bound to `127.0.0.1` only, for local psql / GUI access |
| `migrate` | `Dockerfile` target `migrate` | runs Drizzle migrations once, then exits. `api` and `ingest` wait for it to succeed |
| `api` | target `api` | Fastify API on :8000, internal only, with a `/healthz` check |
| `ingest` | target `ingest` | pg-boss worker and scheduler: live / daily / finalize / nfl-reference jobs |
| `web` | target `web` (Caddy) | serves the built SPA, proxies `/api/*` to `api` on the same origin (no CORS, simple auth cookies). Plain HTTP on `WEB_PORT`: **TLS is terminated by an external reverse proxy** (homelab proxy, Cloudflare Tunnel, …). Caddy trusts `X-Forwarded-*` from private ranges, and the API runs with `TRUST_PROXY`, so secure cookies and client IPs work. |
| `backup` | target `backup` (`postgres:18-alpine` + aws-cli) | daily `pg_dump -Fc` to `./backups` with 14-day retention. **Optional S3 copy** when `S3_BUCKET` is set; works with any S3-compatible store via `S3_ENDPOINT_URL`, and remote retention uses a bucket lifecycle rule. `docker compose run --rm backup once` takes an on-demand backup. |

**Migrations (Drizzle)**
- **Source of truth:** the schema is TypeScript in `packages/db/src/schema`.
- **Creating a migration:** `pnpm db:generate` (drizzle-kit) writes a SQL migration to `packages/db/migrations`, and that file gets committed and code-reviewed.
- **Things drizzle-kit can't express** (the `rec_*` views, gaps-and-islands helper functions, extensions): write them as custom migrations (`drizzle-kit generate --custom`). That keeps everything in one ordered migration history.
- **Applying migrations:** the `migrate` container calls drizzle-orm's `migrate()` at deploy time. drizzle-kit is never in a production image.
- **Policy:**
  - Migrations only move forward: to undo a change, write a new migration.
  - `drizzle-kit push` is for local scratch databases only, never a shared one.
  - Destructive changes take two deploys: first add the new column and backfill it, then drop the old one.
- **Derived tables** are rebuilt by jobs, not migrations. A migration that changes how derived data is computed bumps a `derive_version`, and `ingest` then recomputes on startup.

**Not hosting-specific.** Nothing assumes a homelab or a VPS: any Docker host with an HTTPS reverse proxy in front of `WEB_PORT` works.

**Build and deploy**
- **CI** (`ci.yml`, every PR and push): lint, typecheck, migrations applied to an empty Postgres, `drizzle-kit check`, unit + integration tests.
- **Release** (`release.yml`, push to `main` or a `v*` tag): builds each target and pushes `ghcr.io/zeknikz/rfp-{migrate,api,ingest,backup,web}`. Tags are the git SHA, `latest` on main, and semver on tags.
- **Deploying:** set `RFP_TAG` in `.env`, then `docker compose pull && docker compose up -d`. `migrate` runs first automatically. Rolling back = set the previous SHA tag and run the same command. Note that migrations aren't rolled back, which is why destructive changes take two deploys.

**Local development:** only Postgres runs in Docker (`docker compose up -d db`). The apps run on the host with `pnpm dev`: Vite dev server, API and worker under `tsx watch`, and Vite proxying `/api` so it matches production's same-origin setup.

**Monitoring**
- **Uptime:** UptimeRobot's free plan (personal use, 5-minute checks) against `https://<domain>/api/healthz`. On a homelab, self-hosted Uptime Kuma is an alternative.
- **Health checks:** `/healthz` reports DB connectivity plus the last successful `finalize` / `daily` run, so a stuck worker shows up as down.
- **Job history:** sync job logs are in the admin UI.

**Tests:** Vitest. Unit tests cover `packages/core` (optimal lineup, medians, streaks, bracket classification, every bug in §1.4). Integration tests run record queries against a real Postgres: the CI service container, or Testcontainers locally. Fixtures are small, hand-built leagues with known answers.

**Monorepo build:** pnpm workspaces + Turborepo, Node 24 LTS. A single `Dockerfile` builds everything once, then `pnpm deploy --prod` prunes each deployable to its production dependencies. Runtime images are `node:24-alpine` + `tini`, running as a non-root user.

### 3.11 Frontend: same look, cleaned up

The goal is **the same look and feel** with the internals rebuilt. Someone who uses the current site should feel at home on the new one.

**Keep (the look and feel)**
- Mantine. Upgrade to the current major version, but keep the default Mantine look rather than a new design system.
- `AppShell` layout: 60px header, 250px navbar, burger + collapsible navbar on mobile.
- Brand header: logo (blue / red variant chosen by the league's `color`) + site name in **Bebas Neue**, with the league name in the league color.
- Light/dark mode defaulting to the system setting, plus the toggle button in the header.
- Navbar: league `SegmentedControl` (in the league color), season select (`2024 - 2025` labels), Phosphor nav icons, collapsible groups (Records → Trophies / Overall / Single Season / Managers).
- Record pages: a section per category with a title, a dropdown to pick the record, then a table. Filters are `SegmentedControl`s with the emoji labels (🏈 All / 📅 Regular Season / 🏆 Playoffs / 💩 Toilet Bowl / 🏅 Postseason; 🧡 Season Default / ✅ Include / 🔷 Only Medians / ⛔ Exclude). Tables keep pagination + page-size select, the "Data available from YYYY" caption, and grey parenthesized hint text (e.g. `10 (2021, 2023)`).
- Manager matchup heatmap: red → neutral → green, with the MEDIAN column.
- Version-history modal that opens automatically once per new version, plus a nav link to reopen it.
- Blog post cards on Home.

**Fix / clean up**
- **Data loading:** no global "load everything" step and no full-page loading overlay. Each table fetches its own data with TanStack Query and shows a skeleton while loading, plus proper empty and error states. Remove "Reload all data" and the refresh button, since data now lives on the server.
- **Filter state:** filters live in URL search params, so any record view is a shareable link. Changing a filter resets to page 1.
- **Version history:** one modal instance (it's currently rendered in both `App` and `Layout`). Its content comes from the API, managed in the admin UI (§3.9).
- **Logo:** stop setting the document title inside `Logo`. Page titles come from route metadata.
- **Blog:** the API fetches and caches the Wix RSS feed (`GET /api/blog`), so the browser no longer goes through the third-party `allorigins` proxy.
- **CSS:**
  - Use CSS modules + Mantine theme tokens, with no inline `style={{…}}` for layout.
  - Make everything dark-mode aware with `light-dark()` / theme variables, and no hardcoded hex colors.
  - Move the changelog markdown styles out of `index.html`.
  - Compute heatmap colors with CSS `color-mix()` from theme colors, and pick the text color for contrast on each cell.
- **Mobile:**
  - Filter rows wrap cleanly.
  - The season filter switches from a `SegmentedControl` to a `Select` when there are more than ~6 options or below the `sm` breakpoint. It currently overflows horizontally.
  - Every table sits in a horizontal scroll container with a sticky first column.
  - The heatmap's rotated header uses proper CSS instead of the `rotate: 210deg` hack.
- **Tables:**
  - The rank column uses the server's `RANK()`, so ties share a position.
  - Numbers are right-aligned with `font-variant-numeric: tabular-nums`.
  - Team, manager and week cells link to their pages.
  - Rows from an in-progress season get an "in progress" badge.
  - The non-functional `MultiSelect` filters are removed; filters come from the record catalog instead.
- **Unbuilt pages** appear in the nav **greyed out with a "Soon" badge** and aren't clickable.
- **Performance:**
  - Each route is code-split, including the admin chunk.
  - Unused dependencies are dropped: `@mantine/charts`, `@mantine/dates`, `@mantine/modals`, `@mantine/nprogress`, `@mantine/tiptap`, `@tiptap/*`, `recharts`, `events`, `string-hash`, `rss-parser` (moves to the API), `color-interpolate`, `format-number` (→ `Intl.NumberFormat`), `lodash` (→ native).
  - One icon library (Phosphor). Tabler is dropped.
- **Accessibility:** `aria-label`s on icon buttons, visible focus states, and heatmap contrast.

**URLs** (readable; old `/L-xxxx` links aren't redirected and fall through to `/`):

```
/                                   → /{first league}
/:league                            Home (season snapshot + blog)
/:league/records                    Trophies
/:league/records/overall?seasons=2024&scope=playoffs&median=default&page=2
/:league/records/single-season
/:league/records/managers
/:league/franchises/:franchise      franchise profile
/:league/:season/standings          season pages; /:league/standings = latest season
/:league/:season/matchups[/:week]
/:league/:season/teams[/rosters]
/:league/:season/transactions
/:league/:season/draft
/:league/picks                      future picks (dynasty)
/admin/*                            admin UI (§3.9)
```

The navbar's season select only changes the `:season` segment on season pages. Records pages use their own `seasons` filter.

**Home page:**
- In season: current standings, this week's matchups (live) and recent transactions, then blog posts.
- Off-season: last season's final results (podium + toilet bowl), then blog posts.

**Dropped:** the Math Test page.

---

## 4. Record catalog

Legend:
- **Grain:** see §3.3.
- **Filters:** `Sn` = seasons, `Sc` = scope, `Pos` = positions, `Slot` = starter/bench/IR/taxi, `NZ` = exclude zeroes, `1/S` = one per season.
- **Active:** `inc` = partial season included, `flag` = included but marked in progress, `cmp` = completed seasons only.
- **Needs:** data needed beyond the matchup scores, which every record uses.

### 4.1 Trophies

| Trophy | Definition | Needs |
|---|---|---|
| Winners Circle | `final_place = 1` | final placements |
| Podium Finishers | `final_place in (2, 3)` | final placements |
| Losers Circle | `final_place = team_count` | final placements |
| High Scorer's Club | any counted team-week with `points > league_threshold.high_scorer` (redraft 190 / dynasty 200) | `league_threshold` |
| Benchwarmer's Club | any counted team-week with `points < league_threshold.benchwarmer` (redraft 65 / dynasty 90) | `league_threshold` |

Trophies are a derived `trophy` table (`kind`, `team_season_id`, `team_week_id?`, `value`), rebuilt during `finalize`. The trophy case and the threshold clubs read from it.

### 4.2 Overall records (single event)

| Record | Grain | Filters | Active | Needs |
|---|---|---|---|---|
| Highest / lowest score | team_week | Sn Sc | inc | — |
| Largest blowout / narrowest win | team_week (winner side) | Sn Sc | inc | — |
| Highest / lowest potential points (with actual points) | team_week | Sn Sc | inc | player_week (all rostered), position snapshot |
| Highest $ on a single waiver claim | transaction_item | Sn | inc | FAAB bids (`has_faab`) |
| Highest $ on a single draft pick | draft_pick | Sn | inc | auction amounts (`has_auction_draft`) |
| Player highest score / non-zero lowest score / benched highest / roster lowest | player_week | Sn Sc Pos Slot NZ | inc | player_week incl. BN/IR, slot + position snapshot |
| Most moved player | player × (season or all-time) | Sn | inc | transactions incl. drops, status |
| Broadest trade (# teams) / largest trade (# players) | transaction | Sn | inc | trade items |
| Biggest benchwarmer (most bench points, season) | player_season (per team) | Sn Pos | flag | player_week BN |
| Best score that didn't count (team) + best player on it | team_week `counts = false` | Sn | inc | `team_week` rows for no-game weeks |

The four player records are one record with presets: "benched highest" = `Slot=bench`, "roster lowest" = all slots + `NZ`.

### 4.3 Single-season records (season is a column; `1/S` toggles "season max")

| Record | Grain | Filters | Active | Columns |
|---|---|---|---|---|
| Highest / lowest PF, highest / lowest PA | team_season | Sc 1/S | highest: flag, lowest: cmp | team/manager, season, points |
| Most wins / most losses | team_season | Sc median 1/S | most wins: flag, most losses: flag | record W-L-T, points |
| Highest / lowest win % | team_season | Sc median 1/S | cmp | win %, record W-L-T |
| Highest / lowest lineup IQ | team_season | Sc 1/S | cmp | IQ, PF, potential PF |
| Player highest season score | player_season | Sc Pos 1/S | flag | player, season, position, team(s); best and worst game (week + manager), PPG, PPG excl. zeroes |
| Most / fewest trades | team_season | 1/S | most: flag, fewest: cmp | trades |
| Most / fewest waiver claims | team_season | 1/S | most: flag, fewest: cmp | claims |
| Most / least $ on waiver claims | team_season | 1/S | most: flag, least: cmp | claims, total $ (`has_faab`) |
| Highest / lowest % of drafted players kept to season's end | team_season | 1/S | cmp | % (`player_tenure`) |

`player_season` is per **(player, team season)** by default, so a player who was traded shows up for each team. A "whole league" toggle sums across teams, and the team column then lists every team he played for.

### 4.4 Manager (franchise) records

| Record | Grain | Filters | Active | Notes |
|---|---|---|---|---|
| W/L: years, W, L, T, win %, longest W/L streak (+ seasons) | franchise_career | Sn Sc median | inc | streaks per season; ties list every holding season |
| Placements: playoff and toilet bowl appearances, highest, lowest and average placement (+ seasons) | franchise_career | Sn | cmp | |
| Transactions: # trades, # waiver claims, $ spent | franchise_career | Sn Sc | inc | Sc uses the transaction week's game type for that team (§3.4) |
| Scoring: highest and lowest score (+ week), PF, PA, games, avg PF, avg PA | franchise_career | Sn Sc | inc | |
| Lineups: perfect lineups, missed points, lineup IQ | franchise_career | Sn Sc | inc | perfect = optimal − actual < 0.01 |


### 4.5 Additional records (accepted)

All accepted. They're grouped by data cost. Everything in the first group runs on data the schema above already has.

**No new data**
- **Unluckiest loss:** lost while having the 2nd-highest (or Nth-highest) score of the week. And its mirror, **luckiest win**: won with a bottom-3 score.
- **Should've won:** losses where your *optimal* lineup would have beaten the opponent's actual score. Counted per franchise, plus the single worst one ("left X points on the bench in a 2-point loss").
- **Coulda been a contender:** playoff eliminations that a perfect lineup would have survived.
- **All-play record and luck:** season all-play win %, plus luck = actual wins − all-play expected wins, for both luckiest and unluckiest seasons.
- **Schedule swap:** your record with another franchise's schedule. Gives a "best possible record" and "worst possible record" per season.
- **Weekly high / low score counts:** most weeks as the league's top scorer (or bottom scorer) in a season or career.
- **One-man show:** highest share of a team's points from one player (`top_player_share`).
- **Biggest boom / bust vs. projection:** team-week and player-week actual − projected. Also **biggest upset**: a win despite the largest projected deficit.
- **Era-adjusted highest score:** highest weekly z-score, so scores are comparable across scoring and roster changes.
- **Close-game and blowout records:** record in games decided by < 5 points, and by > 50.
- **Rivalries:** most-played pairing, most lopsided head-to-head, longest head-to-head win streak.
- **Seed vs. finish:** lowest seed to win the title, top seed with the worst finish, worst record to make the playoffs, best record to miss them.
- **Worst champion / best non-champion:** by season PF or all-play.
- **Season trajectory:** most weeks in first place without winning the title; biggest drop from week N first place (`team_season_week`).
- **Droughts and dynasties:** longest title drought, consecutive playoff appearances, back-to-back toilet bowls.
- **Heartbreaker clubs:** losing a playoff game by < 1 point, losing to the median with a 2nd-place weekly score.

**Needs `player_tenure` / transactions (already planned)**
- **Best waiver pickup:** points scored *as a starter* for the team after acquiring the player, rest of season.
- **Trade winner:** for each side, starter points the acquired players scored for their new team over the rest of the season. Gives "most lopsided trade" and "best trade".
- **Journeyman:** player rostered by the most different franchises, in a season or all-time.
- **Loyalty:** longest continuous stint for one player on one franchise (dynasty especially).
- **Boomerang:** player dropped or traded and later re-acquired by the same franchise.
- **Drop regret:** most points a player scored for someone else after you dropped him.
- **Most FAAB per point / best $ value pickup.**

**Needs draft data (already planned)**
- **Draft steal / bust:** season points vs. draft position, overall and by round.
- **Auction value:** points per $, plus most $ spent on the worst finisher.
- **Best and worst draft class:** total starter points from a team's draft picks.

**Needs NFL reference data (§3.8)**
- **Asleep at the wheel:** most starters on an NFL bye or inactive, per week, season and career. Also the single worst week, and points lost to it (the best eligible bench replacement's points).
- **Bye-week blunders that cost a game:** losses where swapping the bye/inactive starters for bench players would have won.
- **Bye-week survivor:** highest team score in a week with the most of its starters' NFL teams on bye. Also a "heaviest bye week survived" count.
- **NFL game stack:** most points from players in a single NFL game (needs `nfl_game_id`).

---

## 5. ESPN data contract (for the later Playwright scraper)

The scraper must fill the same canonical tables Sleeper does. For each ESPN season we need:

| Data | Needed for |
|---|---|
| League settings: roster slots, bench/IR sizes, scoring settings, regular-season weeks, playoff teams, playoff start week, median setting, losers bracket on/off | game types, optimal lineups, projections |
| Teams + owners (SWIDs) + team names/avatars + divisions | manager identity, franchises |
| Weekly matchups with both teams' points, **plus every team's score in weeks it had no game** (playoff byes, eliminated teams) | everything; "scores that didn't count" |
| Per-week box scores: **every rostered player** (starters, bench, IR), lineup slot, actual points, projected points, the player's position / eligible positions that week | potential points, lineup IQ, player records, benchwarmer, `player_tenure` |
| Playoff bracket: winners and losers bracket games, **including placement games**, and the placement each one decides | scopes, placements |
| Final standings / placements | placement records, trophies |
| Transactions: trades (players, picks, FAAB), waivers with FAAB bids and **status (won / failed)**, free-agent adds, drops, each with week + timestamp | transaction records, most moved, tenure |
| Draft: picks, order, auction amounts, keepers | draft records, retention % |
| Team names / avatars as of that season | display |

**Where it runs:** on your desktop, not the server, as `pnpm scrape:espn` in `apps/scraper`. It isn't containerized.

**Flow**
1. Playwright opens a **headed** browser on ESPN's login page and **you log in by hand** (including any 2FA or captcha). The script waits until it sees the `espn_s2` / `SWID` cookies. Nothing about ESPN credentials is stored in `.env`.
2. A persistent browser profile (`.espn-profile/`, git-ignored) keeps you logged in between runs. Delete it to force a fresh login.
3. It reads ESPN's JSON views using those cookies: `mSettings`, `mTeam`, `mRoster`, `mMatchupScore`, `mBoxscore` per `scoringPeriodId`, `mTransactions2`, `mDraftDetail`, plus `leagueHistory` for older seasons. That's much sturdier than scraping the page.
4. Output is a **bundle file per season**: compressed JSON of every raw response plus a manifest. The bundle doubles as a permanent archive of the irreplaceable ESPN data. Keep it in the S3 bucket too.
5. Import: upload the bundle in the admin UI (`POST /api/admin/import/espn`). It goes into `raw_payload`, then the normal normalize → derive pipeline runs, and the UI reports unmatched players and other data gaps. The scraper never needs network access to the server's database.

Check per season for gaps in older years.

**Player IDs:** map ESPN players to canonical ones via `espn_id`, from Sleeper's player dump plus the dynastyprocess crosswalk (§3.8). Anything that doesn't match goes to the admin UI's unmatched-player queue (§3.9).

---

## 6. Build order

1. `packages/db` schema + migrations. `packages/core` compute, with tests for every issue in §1.4 and the decisions in §2.
2. Sleeper ingest (league, users, rosters, matchups, **brackets**, **transactions**, **drafts**, projections) and the derive step. **One-time Mongo migration script** (`pnpm migrate:mongo`) copies the cached ESPN seasons and the config document into the new tables. Mongo stays read-only until cutover, then gets shut down.
3. Record engine. Port the ~30 existing records and compare against the current site, accounting for the known bugs.
4. NFL reference data (§3.8): schedule, weekly rosters, ID crosswalk, backfilled for every season we have.
5. API, then the new UI, including the admin UI (§3.9). Auth and admin config ship before anyone outside can reach the site: the config tables replace the Mongo config document, so the admin UI is how config gets edited from then on.
6. ESPN data contract audit + Playwright scraper.
7. The new records (§4).

## 7. Open items to check during build

- What Sleeper returns in playoff weeks for teams with no bracket game (`matchup_id` null?). The answer decides the `game_type = 'none'` handling.
- How Sleeper's `p` field and the losers bracket behave across seasons, including how losers-bracket placements map onto final placements.
- Whether ESPN's historical seasons have full per-player box scores and projections.
- Whether ESPN box scores include bench and IR players for older seasons. Without them, potential points and bench records don't work for those seasons, and `has_player_data` covers it.
- Whether Sleeper returns points for teams with no playoff game. If not, those weeks can't support "scores that didn't count".
- How stat corrections show up after a week is finalized. `finalize` must be safe to re-run.
- Whether the existing Mongo ESPN data has bench / IR / transactions / draft. That decides how much the scraper has to re-collect versus what we can migrate.
