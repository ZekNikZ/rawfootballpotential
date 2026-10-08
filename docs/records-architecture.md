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

| Filter       | Single-game records                                                         | Manager records                                                                   |
| ------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Season "All" | no filter applied                                                           | entries with `league === undefined` (pre-aggregated)                              |
| Scope values | `in-season` / `playoffs` / `toilet-bowl`; the UI builds "postseason" itself | `undefined` / `in-season` / `postseason`; playoffs and toilet bowl can't be split |
| Median       | n/a                                                                         | only the standings records support it                                             |

`RecordTable` guesses which convention applies from `hasNullLeague`, `hasNullScope` and `hasPostseasonScope`.

### 1.4 Correctness issues (write tests for these in the rewrite)

1. **Postseason plus medians mixes in regular-season games.** In `managerCareerStandingsRecord`, median wins are added without checking scope, so "Postseason + Include medians" counts regular-season median wins.
2. **Ties count as a win for team 2.** Every file uses `team1.points > team2.points`. The median comparison uses `>=`, so a score equal to the median counts as a win.
3. **Season trophies are computed wrong** (`utils/trophies.ts`):
   - `pointsFor` only adds the winner's score.
   - `pointsAgainst[loser]` adds the loser's _own_ score.
   - Both include playoff weeks.
4. **"Years in league" ignores the season filter.** It always shows the career total.
5. **Median streaks are inconsistent.** "Include medians" streaks ignore median results; median results only feed the "only medians" streaks.
6. **Playoff vs. toilet bowl is a guess.** It's decided by `week >= playoffWeekStart` plus whether team 1 is in `playoffQualifiedTeams`. For Sleeper, that list is rebuilt by sorting the _current_ roster `settings.wins`. Brackets are never read, so placement games can't be identified.
7. **Possible fake games in playoff weeks (needs checking).** Sleeper's docs don't say what `matchup_id` is for teams with no game. If it's `null`, `groupBy(matchup_id)` puts every idle team into one "matchup", and the code treats the first two as a real game.
8. **Optimal lineups use today's player positions.** They read `nflPosition` from the _current_ player dump, not what the player was eligible for that week, and ignore multi-position eligibility (`fantasy_positions`).
9. **Manager lookups assume one manager per team per season.** The reverse lookup is an `Object.keys(...).find` scan inside hot loops, and there's no concept of co-managers, owner changes or franchises.
10. Sleeper brackets, transactions and drafts are `"NOT IMPLEMENTED"` casts.

### 1.5 The main takeaway

Most of the slowness comes from _how data is loaded_, not from where the math runs:

- live Sleeper rebuilds on every request,
- league seasons fetched one at a time,
- a 5MB player dump shipped to the browser,
- every filter combination computed before the first paint.

The data is small: about 10 seasons × 17 weeks × 12 teams ≈ 2k team-games, and a few hundred thousand player-games. Postgres can aggregate and rank that at request time in milliseconds.

---

## 2. Decisions

| Topic                                | Decision                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Head-to-head ties**                | Stored as `T`. Win % = (W + 0.5·T) / games played. A tie ends both a win streak and a loss streak. No tiebreaker: it would make our standings disagree with the platforms' official ones.                                                                                                                                                                       |
| **Median game**                      | Compared against the **true median** of all teams' scores that week (the middle score; the average of the two middle scores when the team count is even). It doesn't depend on head-to-head results.                                                                                                                                                            |
| **Median ties**                      | A score exactly equal to the median is a **tie** (`T`), same as head-to-head.                                                                                                                                                                                                                                                                                   |
| **Median scope**                     | Median games exist only in regular-season weeks.                                                                                                                                                                                                                                                                                                                |
| **Streaks**                          | **Per season** by default. A cross-season streak is a separate, later record (`streakAcrossSeasons` param, same query).                                                                                                                                                                                                                                         |
| **Entity**                           | Records follow the **franchise**. Displayed manager: that season's manager when the record covers one season (a single game or a season total); the franchise's **current** manager (most recent season) when it spans several seasons.                                                                                                                         |
| **Redraft franchises**               | Franchise = manager. Same person means same franchise, and a new person means a new franchise.                                                                                                                                                                                                                                                                  |
| **Dynasty franchises**               | Dynasty only exists on Sleeper (no ESPN dynasty leagues). The model still supports any configuration: the season-to-franchise mapping is explicit config, seeded from Sleeper's `previous_league_id` + `roster_id`.                                                                                                                                             |
| **Postseason scopes**                | **Follow the bracket.** Winners-bracket games, _including placement games_ (3rd, 5th, …), are `playoffs`. Losers-bracket games, including their placement games, are `toilet_bowl`. `postseason` = both. Each game also stores `placement_at_stake` and `is_championship`, so filters like "championship only" or "exclude placement games" can be added later. |
| **Seasons without a losers bracket** | Playoff-week games with no bracket entry are marked `game_type = 'none'`: kept in the data but **left out of every scope**. Ingestion will report what the source actually contains for those weeks.                                                                                                                                                            |
| **Scope filter**                     | The same 5-way filter everywhere a record is scope-aware: All / Regular / Playoffs / Toilet bowl / Postseason.                                                                                                                                                                                                                                                  |
| **Player season totals**             | Only the weeks the player was **rostered in the league**, scored with that season's league scoring. A player can contribute to more than one team in a season. No full NFL stat pull.                                                                                                                                                                           |
| **"Bye week" scores**                | A team's score in a week with **no counted game** (playoff bye, eliminated, no bracket game), plus the best player on that roster that week. Stored as `team_week` rows with `counts = false`.                                                                                                                                                                  |
| **Drafted-player retention**         | The player is on the **team that drafted him in the final week of the season**. Traded or dropped = no, even if he was re-acquired later; that's checked with `player_tenure` (one continuous stint from draft to final week).                                                                                                                                  |
| **Waiver claims**                    | Only **successful** claims count. Failed claims are stored but never counted. Whether free-agent adds count is decided **per record**: each transaction record's definition says which transaction types it includes (`txTypes: ["waiver"]` or `["waiver", "free_agent"]`). It's not a user filter. "$ spent" = winning FAAB bids.                              |
| **Trade size**                       | "Largest trade" = number of distinct **players** moved. Picks and FAAB don't count, but are shown as extra columns. "Broadest" = number of distinct teams.                                                                                                                                                                                                      |
| **Most moved player**                | Number of distinct completed transactions involving the player. A trade = 1 and a drop = 1; another team then adding him = 1 more. Example: dropped by A, claimed by B, traded to C = 3.                                                                                                                                                                        |
| **Live data in records**             | Records only read **completed weeks**. Each record declares whether a partial in-progress season counts (see §3.3).                                                                                                                                                                                                                                             |

---

## 3. Target architecture

### 3.1 Three tiers of computation

```
 Sleeper API ─┐                         ┌─> derived facts ─┐
              ├─> raw ─> normalize ─────┤                  ├─> record query (SQL, filters) ─> cache ─> API ─> UI
 ESPN scrape ─┘   (jsonb)  (canonical)  └──────────────────┘     keyed by (record, params, data_version)
```

1. **Ingest time (TypeScript, once per sync):** normalize source data into the canonical schema. Then compute the expensive _per-row_ facts once:
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
                    allplay_w, allplay_l, allplay_t, top_player_share,
                    asleep_starters, bye_starters, asleep_points_lost   (M8, §3.11.3)
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

#### 3.2.1 As built (M1)

The schema lives in `packages/db/src/schema/` (44 tables, 9 `rec_*` views). Differences from the blocks above:

- **Additions:**
  - `nfl_team_alias` (§3.8), `trophy` (§4.1), `unmatched_player` (§3.9) and `admin_verification` (better-auth).
  - `league_season`: `previous_external_id`, `enabled`, `last_week`, `team_count`, `settings jsonb`, `locked_flags text[]` (the `has_*` columns an admin set by hand, which ingest won't overwrite).
  - `matchup.external_matchup_id`.
  - `game_result`: `matchup_id`, `opponent_franchise_id` (for head-to-head matrices).
  - `transaction`: `external_id`, `failure_reason`, `creator_team_season_id`.
  - `draft.slot_order`, `draft_pick.original_team_season_id`.
  - `player.gsis_id`, `player.active`.
  - `player_id_map`: surrogate id and `manual` flag.
  - `league_season.scoring_overrides` (as-played scoring rules, §7), `data_version.deriveVersion` (the §3.10 `derive_version`).
  - `raw_payload`: `params_hash`, `http_status`, `body` (CSV responses), `bundle` (ESPN bundle name), and sources `nflverse | dynastyprocess | blog` besides `sleeper | espn`.
- **Replaced:** `player_week.is_starter` and `roster_current` slot → `slot_kind` enum (`starter | bench | ir | taxi`); it is what the `Slot` filter needs. `admin_user.disabled` → `banned` (better-auth's admin-plugin name).
- **Types:** surrogate keys are `integer generated always as identity`; points are `numeric(10,3)` (exact sums, read back as JS numbers); `nfl_game.id` is nflverse's `game_id` text.
- **Views** (custom migration `0001_rec_views`): `rec_team_week_all` (complete weeks, final rows, enabled seasons; includes no-game weeks), `rec_team_week` (counted only), `rec_game_result`, `rec_matchup`, `rec_player_week`, `rec_team_season`, `rec_transaction` (successful, `week <= last_completed_week`), `rec_transaction_item`, `rec_draft_pick` (completed drafts).
- **Not tables:** pg-boss keeps its own `pgboss` schema; drizzle only manages `public`.

**Toolchain versions (checked at install, 2026-10-05):** TypeScript 6.0 (7.0 is out, but typescript-eslint's range stops below 6.1), drizzle-orm 0.45 / drizzle-kit 0.31 (1.0 is still RC), Node 24 everywhere.

### 3.3 Record engine: metric × grain × direction

Today's categories (`overall`, `single-season`, `manager`) are really **grains**. "Highest score", "most points in a season" and "most career points" are the same metric (`sum(points)`) at different grains.

**Grains**

| Grain              | Row =                                                                   | Example records                                                              |
| ------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `team_week`        | one team in one week (`counts = true` unless the record asks otherwise) | highest score, largest blowout, best lineup IQ, best score that didn't count |
| `matchup`          | both teams in one game                                                  | highest combined score, closest championship                                 |
| `league_week`      | the whole league in one week                                            | highest weekly median                                                        |
| `team_season`      | franchise × season                                                      | most PF in a season, worst champion, best team to miss the playoffs          |
| `franchise_career` | franchise across seasons                                                | career wins, win %, championships, average placement                         |
| `player_week`      | player on a roster in one week                                          | best player performance, biggest bench miss                                  |
| `player_season`    | player × season (weeks rostered in the league)                          | season player score, PPG, biggest benchwarmer                                |
| `transaction`      | one transaction                                                         | biggest trade, highest FAAB bid, best pickup                                 |
| `draft_pick`       | one pick                                                                | best value pick, biggest bust                                                |

**Definitions**

These definitions live in `packages/core`, and the API compiles them to SQL:

```ts
export const metrics = {
  points: { agg: sum("tg.points"), format: "points" },
  margin: { agg: sum("tg.margin"), format: "points" },
  optimal: { agg: sum("s.optimal_points"), format: "points", requires: ["playerData"] },
  lineupIQ: {
    agg: ratio(sum("tg.points"), sum("s.optimal_points")),
    format: "pct",
    requires: ["playerData"],
  },
  wins: { agg: countWhere("gr.result", "W"), source: "game_result" },
  winPct: { agg: winPct("gr"), source: "game_result", qualifier: { minGames: 10 } },
  // ...
};

defineRecord({
  id: "points.high",
  title: {
    team_week: "Highest score",
    team_season: "Most points in a season",
    franchise_career: "Most career points",
  },
  metric: "points",
  grains: ["team_week", "team_season", "franchise_career"],
  direction: "desc",
  filters: ["seasons", "scope", "weeks", "franchise", "opponent"],
  columns: ["entity", "when", "opponent", "metric"],
});

defineCustomRecord({
  id: "streak.win",
  grain: "franchise_career",
  query: (db, p) => winStreakQuery(db, p),
});
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
  - `complete_only`: the in-progress season is left out until it finishes. Examples: lowest season PF/PA, fewest wins, placements, playoff and toilet bowl appearances, draft retention %, lowest trade/claim counts. Without this, a half-finished season would "win" every _lowest_ record.
  - `flag`: included, but the row is marked as in progress in the UI. Example: highest season PF so far.

### 3.4 Filters: one typed, validated query object

```ts
interface RecordQuery {
  seasons: "all" | number[] | { from: number; to: number };
  scope: "all" | "regular" | "postseason" | "playoffs" | "toilet_bowl";
  median: "default" | "include" | "exclude" | "only"; // only on W/L metrics
  weeks?: { from: number; to: number };
  franchise?: FranchiseId;
  opponent?: FranchiseId;
  onePer?: "season" | "franchise"; // "season max": keep only the best row per season (or per franchise)
  // player records
  positions?: Position[]; // the player's position *that week* (player_week.position)
  slots?: ("starter" | "bench" | "ir" | "taxi")[];
  excludeZero?: boolean; // "non-zero" lowest scores
  // team-week records
  countedOnly?: boolean; // default true; false includes byes and eliminated weeks
  divisionOnly?: boolean;
  championshipOnly?: boolean; // future
  excludePlacementGames?: boolean; // future
  streakAcrossSeasons?: boolean; // future, default false
  minGames?: number;
  limit: number;
  offset: number;
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

#### 3.5.1 Records API as built (M4)

- **League in URLs** is the league `slug` (`redraft`, `dynasty`); seasons are addressed by `league_season.id` (from `GET /api/leagues`).
- **One compiled query per engine** (`apps/api/src/records/engines`), shared by records that differ only in sort key and direction. Every query reads the `rec_*` views, and the set of seasons it may read is resolved first: the `seasons` filter, then each season's `has_*` flags against the record's `requires`, then `complete_only` (in-progress seasons dropped). The response reports `availableFrom` and `seasonsIncluded`.
- **Filters** a record does not support are reset to their defaults before the cache key is computed, and a record's `preset` (e.g. "benched highest" = bench slot) overrides the query, so neither can change an answer or fragment the cache.
- **Ranking** is `RANK()` over a value rounded to 3-4 decimals; `onePer` keeps the best row per season or franchise before ranking; stable order within a rank is (season, week, id).
- **Win % qualifier:** 10 games for the `all` and `regular` scopes, 1 for postseason scopes (a postseason slice never has 10 games); `minGames` overrides it. The applied value is returned in `meta.qualifier`.
- **Owner decisions on the catalog (2026-10-06):**
  - **Player records** are six separate records: highest and lowest for the whole roster, for starters only and for benched players only (`player.roster|starter|bench.high|low`). The slot is the record, not a filter. Position, week, franchise and non-zero are user filters; the lowest records exclude zero-point weeks by default. DEF and K are included (so the lowest views are dominated by negative-scoring defenses unless a position filter is applied).
  - **Player seasons** count every week the player was rostered in the league ("Highest scoring player season", "Biggest benchwarmer").
  - **Win % qualifier:** 10 games for the `all` and `regular` scopes, 1 for postseason scopes (a postseason slice never has 10 games); `minGames` overrides it; the applied value is returned in `meta.qualifier`. Median games count by default (§2), so a 17-game season shows as e.g. 24-6.
  - **Teamwide score** is everything every rostered player scored that week (the legacy definition), not the team total, which a commissioner override can change.
  - **Toilet bowl appearance** means playing a losers-bracket game. The 2020/2021 ESPN seasons (no bracket data) and any team a Sleeper bracket left out do not count until the ESPN scraper brings brackets (§5).
  - **Perfect lineup** is the strict §4.4 rule: optimal minus the lineup's starter points below 0.01.
  - **Smartypants** (lineup IQ above 0.999) stays in the trophy case as a club.
  - **Franchise display:** a record shows the franchise's current manager (and latest team name); a single-event or single-season row, or any career row whose filter selects exactly one season, shows that season's team and manager.
- **Cache:** `record_cache` rows are keyed by (record, normalized params, version key) where the version key hashes the `data_version` of the seasons the query read, so completed seasons stay cached through live updates. ETags are derived from that key (not the body). `watchDataVersion` runs inside the API process, notices a finished sync by the `data_version` timestamps, and warms every record's default view in the background (`pnpm --filter @rfp/api prewarm` does it on demand).
- **Parity report:** `docs/m4-parity-report.md`, regenerated by `pnpm --filter @rfp/api parity`.

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

#### 3.6.1 Ingest as built (M3)

- **Entry points** (`apps/ingest`, run with `pnpm ingest <command>`): `migrate-mongo`, `players`, `rollover`, `sync`, `derive`, `nfl-reference`, `job <name>`, `all`, `report`. The same code backs the pg-boss worker (`src/worker.ts`).
- **Raw cache:** every Sleeper, nflverse and crosswalk response goes through `RawStore` and is stored in `raw_payload` (history kept). Completed seasons are served from the cache forever (`FOREVER`); the active season uses short freshness windows; `players/nfl` is fetched at most once per 20 hours. Calls are spaced to about 8 per second. nflverse weekly rosters are stored trimmed to the 11 columns we use (the full file is ~15 MB per season).
- **Job schedule** (cron in `TZ`, default America/New_York): `live` every 5 minutes in game windows (Thu night, Sat, Sun, Mon night); `daily` 05:00; `nfl-reference` 05:30; `season-rollover` 07:00; `finalize` Tuesday 06:00 and a Wednesday re-run. On startup the worker recomputes seasons whose `data_version.derive_version` is behind `DERIVE_VERSION`. Every run is recorded in `sync_run`.
- **Season rollover** has no Sleeper endpoint to ask, so it asks each owner of the newest season for their leagues in the next year and matches `previous_league_id`.
- **Standings tie-break:** record (ties count half), then points for. That is Sleeper's default order; there is no further tie-break.
- **Overrides applied so far:** `team_week.points` (`ls:{league_season_id}:r:{roster}:w:{week}`) during normalize, and `team_season.final_place` (`ls:{id}:r:{roster}`) during derive. `migrate:mongo` stores the legacy hand-entered placements as `final_place` overrides: active for the ESPN seasons (no brackets), inactive for Sleeper seasons (the brackets decide).
- **Trophies:** only the five kinds in §4.1 are produced. The legacy "Smartypants" (lineup IQ > 0.999) trophy is not in §4.1; its threshold is stored (`league_threshold.smartypants`) in case it is wanted back.

### 3.7 Active (current) season support

The active season goes through the same tables as history. "Current" is just a season whose `status` isn't `complete` and whose weeks aren't all `complete`. There's no separate live schema to keep in sync.

**Sync jobs (`apps/ingest`)**

| Job               | When                                                                                                                 | What it does                                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live`            | every few minutes during NFL game windows, active season only                                                        | refreshes `team_week` / `player_week` points for the current week (`is_final = false`). Live scores feed the Matchups page only.                                                                                |
| `daily`           | once a day                                                                                                           | `players/nfl` (current player info), `/state/nfl`, rosters → `roster_current`, transactions, traded picks, draft (if drafting), team names and avatars                                                          |
| `finalize`        | when `/state/nfl` moves past a week and scores are final (Tuesday morning; can be re-run if stat corrections arrive) | marks the week `complete`, sets `is_final`, recomputes the season's derived tables (`team_week_stats`, `game_result`, `team_season_week`, `player_tenure`), bumps the season's `data_version`, pre-warms caches |
| `nfl-reference`   | daily in season; once for backfill                                                                                   | NFL schedule → `nfl_game` / `nfl_team_week`, nflverse weekly rosters → `nfl_player_week`, ID crosswalk → `player_id_map`; then fills `player_week.nfl_team / nfl_game_id / nfl_status`                          |
| `season-rollover` | when Sleeper creates the next season                                                                                 | creates `league_season` (via `previous_league_id`), team seasons and the franchise mapping (redraft: by manager; dynasty: by roster)                                                                            |

**What each info page reads**

| Page                            | Data                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Home                            | current standings (`team_season_week`, latest week), current week's matchups, recent transactions    |
| Standings                       | `team_season_week` (any week; also standings history), divisions, playoff seeds, clinched/eliminated |
| Matchups                        | `team_week` + `player_week` for any week, live while in progress, with projections                   |
| Teams → Divisions / Rosters     | `team_season` + `roster_current` + `player` (injury, NFL team)                                       |
| Transactions → Trades & Waivers | `transaction` + `transaction_item` feed, filterable                                                  |
| Transactions → Future Picks     | `traded_pick` (dynasty)                                                                              |
| Draft                           | `draft` + `draft_pick` (live while drafting)                                                         |
| Records / Trophies              | `rec_*` views (completed weeks only)                                                                 |

**Rules**

- Team names and avatars only exist as "current" in Sleeper. They're overwritten daily while a season is active and frozen once it completes.
- Projections are stored per `player_week` for every week, including the upcoming one, so the Matchups page can show projected scores.
- Info pages may read in-progress weeks. **Records never do** (§3.3).

### 3.8 NFL reference data (bye weeks, NFL teams, inactives)

None of the fantasy APIs give a clean historical "which NFL team was this player on, and was that team on bye" per week. Sleeper's player dump only has _current_ teams. Three free sources cover it. I checked each one on 2026-10-05:

| Source                                                                                                                               | What it gives                                                                                  | Use                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **nflverse `games.csv`**: `https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv`                                 | every NFL game since 1999: `season, game_type, week, gameday, away_team, home_team, scores, …` | **Primary schedule.** A bye = an NFL team with no game in a REG week. One file, all history.                                                |
| **nflverse weekly rosters**: `https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{season}.csv` | per season and week: `team, position, status, sleeper_id, espn_id, gsis_id, …`                 | The player's **NFL team that week** and **active/inactive status**. Includes `sleeper_id` + `espn_id`, so it joins straight to our players. |
| **Sleeper schedule** (undocumented): `https://api.sleeper.app/schedule/nfl/regular/{season}`                                         | `week, home, away, date, status` per game                                                      | **Live-season** cross-check and game status. Undocumented, so it's a fallback, not the source of truth.                                     |
| **dynastyprocess ID crosswalk**: `https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv`                          | `sleeper_id, espn_id, gsis_id, yahoo_id, …`                                                    | Seeds `player_id_map`, mainly for matching ESPN player IDs.                                                                                 |

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

| Role    | Can                                                                             |
| ------- | ------------------------------------------------------------------------------- |
| `owner` | everything below, plus invite, disable and remove admins and change their roles |
| `admin` | edit config, fix data, run syncs and recomputes                                 |

There's room to scope an admin to specific leagues later (`admin_user_league`) without changing the model.

**What the admin UI manages**

| Area                | Config                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Site                | name, short name, changelog / announcements (moves out of `utils/changelog.ts`)                        |
| Leagues             | name, slug, type, color, display order                                                                 |
| League seasons      | add a season (source + external ID), enable/disable, override `has_*` data flags                       |
| Managers            | names and avatars, linked identities (Sleeper user IDs, ESPN SWIDs), merge duplicate managers          |
| Franchises          | season-to-franchise mapping (dynasty), franchise names                                                 |
| Results             | final placement overrides, bracket / `game_type` corrections, score overrides (with a required reason) |
| Thresholds          | `league_threshold` values (High Scorer's / Benchwarmer's / Smartypants …)                              |
| Players             | unmatched-player queue (ESPN / nflverse IDs without a match), manual ID mappings                       |
| Records             | show/hide, order, featured, per-league enable                                                          |
| Data jobs           | trigger `live` / `daily` / `finalize` / `nfl-reference` / recompute; view `sync_run` history and logs  |
| Admins (owner only) | invite, reset password, disable, change role                                                           |

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

#### 3.9.1 Admin as built (M6)

- **Auth:** better-auth 1.7 on the existing `admin_*` tables (Drizzle adapter), email + password, `disableSignUp`, httpOnly SameSite=Lax cookies named `rfp.*` (Secure when `PUBLIC_URL` is https), 14-day sessions, login limited to 5 attempts a minute per IP. The `/api/auth/*` proxy exposes only `sign-in/email`, `sign-out` and `get-session`; the admin plugin's own endpoints (create user, set role, ...) are not reachable, so every account change goes through our audited endpoints. The plugin is kept for the `role` / `banned` columns and for refusing sign-in of disabled users.
- **Guard:** every `/api/admin/*` request needs a session, and the account is re-read from the database each time, so a disabled or demoted user loses access immediately (disabling and demoting also delete their sessions). Writes must carry an `Origin` that is `PUBLIC_URL` or listed in `EXTRA_ORIGINS`. Admin responses are `no-store`. Owner-only: `/users`, `/invites`.
- **Accounts:** the first owner is created with `pnpm admin:create-owner --email you@example.com --name "You"` (password from `ADMIN_PASSWORD` or a hidden prompt; never printed). After that, invites and password resets are one-time links the owner copies and shares (`/admin/accept?token=...`): 32 random bytes, only the SHA-256 is stored, 3 days (invite) / 24 hours (reset), consumed atomically, rate limited to 10 requests a minute per IP. A reset also signs the user out everywhere. The owner can't disable, demote or delete themselves, and the last active owner is protected. (Migration `0003` added `admin_invite.purpose` and `user_id` for resets.)
- **Corrections** (`override` rows, one active per target; creating one deactivates the previous, deactivating needs a reason): final placement (any season), team-week score and game type (`regular | playoffs | toilet_bowl | none`, Sleeper seasons only: ESPN seasons have no normalize step to apply them yet, so the API refuses them with a clear message). Normalize reads them (`teamWeekOverrideKey`, `matchupOverrideKey`; placements in derive), so a re-pull from Sleeper never undoes them. Saving queues a `recompute` job with `renormalize: true` (re-runs normalize from the cached raw data, then derive; offline for completed seasons); thresholds and placements queue a derive-only recompute. Tests prove each kind survives a forced full re-ingest and comes back to the original value when removed.
- **Config:** site name and changelog, leagues (name, slug, color, order, enabled), seasons (enable, per-flag on / off / auto where on/off lock the value against ingest via `locked_flags`, as-played scoring rules), add a Sleeper season by id (queued `add-season` job, run by the worker), managers (rename, link / unlink Sleeper and ESPN accounts, merge duplicates), franchises (rename, move a team season to another franchise), trophy thresholds, record visibility / featured / position (global or per league; the public catalog applies them), unmatched-player queue (match teaches the importer the id; ignore), job triggers and run history, audit log. Edits that change what public pages serve bump the seasons' `data_version` so record caches refresh.
- **ESPN bundles** (`POST /api/admin/import/espn`, multipart, gzip or plain JSON, up to 150 MB): validated against the bundle format (`espnBundle` in `packages/core/src/admin.ts`: manifest with league slug, year, ESPN league id, scrape time, plus the raw responses), checked against an existing ESPN season, archived verbatim in `raw_payload` with a bundle name, and recorded as an `import_espn` run. **Normalizing a bundle into the canonical tables is not built yet** (it needs the scraper's real output, M9); the UI and the run log say so.
- **UI:** `/admin/*` is a lazy chunk (`login`, `accept`, then a guarded shell with Overview, Site & changelog, Leagues & seasons, Managers & franchises, Corrections, Trophy thresholds, Unmatched players, Records, Data jobs, ESPN import, Admins, Audit log). Forms use Mantine form with the zod schemas in `@rfp/core/admin` (shared with the API). `pnpm --filter @rfp/web admin:screenshots` signs in and walks every page (needs `ADMIN_EMAIL` / `ADMIN_PASSWORD`).
- **Config added:** `BETTER_AUTH_SECRET` (32+ chars; the admin API is off without it), `PUBLIC_URL`, `EXTRA_ORIGINS` (dev: `http://localhost:5173`).
- **Tests:** `admin-authz.test.ts` (23: no session on any admin route, owner-only routes closed to admins, disabled / demoted users, Origin checks, no sign-up, login and invite rate limits, one-time invite and reset links, last-owner protection, audit) and `admin-data.test.ts` (16: override-survives-re-ingest for score, placement and game type, ESPN restrictions, locked flags, thresholds, merge, record settings, unmatched queue, jobs, bundle import, audit coverage). The route-level checks enumerate every route registered under `/api/admin`, so a new unguarded route fails the suite.

### 3.10 Infrastructure

Files: `docker-compose.yml` and `.env.example` at the repo root, `infra/` (multi-target `Dockerfile`, `Caddyfile`, `backup.sh`) and `.github/workflows/` (CI + image release), all on the **`rewrite` branch** of this repo. The current site keeps running from `main` until cutover.

**Containers (one machine)**

| Service   | Image                                            | Role                                                                                                                                                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`      | `postgres:18-alpine`                             | data. Port bound to `127.0.0.1` only, for local psql / GUI access                                                                                                                                                                                                                                                                                    |
| `migrate` | `Dockerfile` target `migrate`                    | runs Drizzle migrations once, then exits. `api` and `ingest` wait for it to succeed                                                                                                                                                                                                                                                                  |
| `api`     | target `api`                                     | Fastify API on :8000, internal only, with a `/healthz` check                                                                                                                                                                                                                                                                                         |
| `ingest`  | target `ingest`                                  | pg-boss worker and scheduler: live / daily / finalize / nfl-reference jobs                                                                                                                                                                                                                                                                           |
| `web`     | target `web` (Caddy)                             | serves the built SPA, proxies `/api/*` to `api` on the same origin (no CORS, simple auth cookies). Plain HTTP on `WEB_PORT`: **TLS is terminated by an external reverse proxy** (homelab proxy, Cloudflare Tunnel, …). Caddy trusts `X-Forwarded-*` from private ranges, and the API runs with `TRUST_PROXY`, so secure cookies and client IPs work. |
| `backup`  | target `backup` (`postgres:18-alpine` + aws-cli) | daily `pg_dump -Fc` to `./backups` with 14-day retention. **Optional S3 copy** when `S3_BUCKET` is set; works with any S3-compatible store via `S3_ENDPOINT_URL`, and remote retention uses a bucket lifecycle rule. `docker compose run --rm backup once` takes an on-demand backup.                                                                |

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

**One-off commands in the images.** The `ingest` image also ships the CLI (`node dist/cli.js derive | sync | nfl-reference | espn <bundle> | report`) and the `api` image the owner bootstrap (`node dist/create-owner.js`), so a production host never needs a checkout. The cutover steps are in [`cutover.md`](cutover.md).

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

#### 3.11.1 Frontend as built (M5)

Stack: Vite 8, React 19, Mantine 9, React Router 8 (data router, every page lazy-loaded), TanStack Query 5, Phosphor icons, zod schemas for every API response (`apps/web/src/api/schemas.ts`; `pnpm --filter @rfp/web check:contract` parses every endpoint of a running API with them).

Differences from the plan above, and decisions the plan left open:

- **Filter params are prefixed per section.** One records page holds several sections, each with its own record picker and filters, so URL params are `?single-week-scores.rec=blowout&single-week-scores.scope=playoffs&single-week-scores.seasons=2024&single-week-scores.page=2` (section slug + dot + the API's own filter name). Defaults are omitted from the URL; changing a filter drops that section's `page`. The heatmap uses the prefix `matchups.`.
- **Season picker** (navbar) shows only where a season applies: season pages (`/:league/:season/...`) and Home (`/:league?season=2025`). Records pages and franchise profiles have their own `seasons` filter, so the picker is hidden there. Options list newest first.
- **Home** follows the selected season: in season it shows standings, this week's matchups (refreshed every minute, "live" badge) and the latest 8 transactions; a completed season shows its podium and last place. The compact panels use the M4 season endpoints; the full pages are M7.
- **Filter controls come from the catalog.** Each record lists its filters; presets are hidden; a control with more than 6 options, or any control below the `sm` breakpoint, becomes a select. The weeks filter is two number inputs, team/opponent are searchable selects of franchises (current manager + current team name). Defaults chosen by the server (e.g. "exclude zero-point weeks" on lowest-player records) are shown as the control state.
- **Franchise labels without a season** (heatmap rows/columns, trophy cabinet, franchise page header) use the franchise's current manager (owner decision).
- **Trophies page** (the legacy site had it disabled): season filter, champions/podium/last place per season, a trophy cabinet by manager, the three clubs (paged lists) and the season awards table. "Best lineup IQ of the season" is a tie among all perfect lineups in most seasons, so it shows a count instead of 90 teams.
- **Version history** loads `react-markdown` only when first opened (separate 40 kB chunk).
- **Page titles** come from route `handle.title`; a page whose title depends on data (franchise profile) refines it with `usePageTitle`.
- Tooling: `pnpm --filter @rfp/web screenshots` (every page, light/dark, desktop/mobile, into the git-ignored `docs/screenshots/m5/`) and `pnpm --filter @rfp/web smoke` (browser test of URL-backed filters, paging, the version-history modal and no sideways page scroll at 390 px). Both need the dev server (`pnpm --filter @rfp/web dev`) and the API running; set `PW_CHROMIUM` to an installed Chromium to avoid downloading Playwright's.

#### 3.11.2 Info pages as built (M7)

All six pages are live and the nav no longer shows "Soon" items (the capability stays in `nav.tsx` for later). They read the M4 season endpoints, and nothing else changed on the server.

- **Standings** (`/:league/:season/standings`): week picker (`?week=`), overall or by-division view (`?view=divisions`, only when the season has divisions), a line under the last playoff spot for a season in progress, final placement for a completed one. Median games are in the W-L (doc §2) and the page says so.
- **Matchups** (`/:league/:season/matchups/:week?`): previous / next / week select, a live / final / upcoming badge, a refresh every 30 s while the week is in progress, game cards with projections, bracket and placement-at-stake badges, tie and "adjusted" (commissioner override) markers, expandable lineups (starters / bench / IR with bye and injury marks), and the teams that had no game.
- **Teams** and **Rosters** (`/teams`, `/teams/rosters`): team cards by division; rosters as an accordion (slot, position, NFL team, injury, how acquired), as of the latest sync.
- **Transactions** (`?type=`, `?team=`, `?page=`): trades shown as what each team gets, claims and free agents as adds / drops with the FAAB bid, failed claims marked and never counted.
- **Draft**: a board (rounds x pick slots, with "to Team" when a pick was traded and a keeper badge) for snake and linear drafts and a list with prices for auctions; a switch when a season has more than one draft.
- **Future Picks** (dynasty): traded picks with the original and current owner (franchise labels use the current manager), filterable by owner.
- `/:league/standings` (and `matchups`, `teams`, `teams/rosters`, `transactions`, `draft`) redirect to the latest season.
- Seasons without a kind of data (the 2020 / 2021 ESPN years have no transactions, drafts or lineups) say so in place of an empty page. `check:contract` now parses every season's responses for these endpoints.

#### 3.11.3 Additional records as built (M8)

All of §4.5 is in the catalog: 68 records in 17 sections (139 records in all, 144 with the power rating and the point-differential records below), each with a one-line description shown under the picker. They need no new API route, no new column type and no change to the web app: the catalog drives the pages. The only schema change is three columns on `team_week_stats` (below), which bumps `DERIVE_VERSION` to 2; a server that takes this release must run `derive` for every season once (the worker does it on its own, because `data_version.derive_version` is behind) and apply migration `0004`.

**New derived columns** (`team_week_stats`, filled by derive from `player_week`): `asleep_starters` (starters on a bye or not active), `bye_starters` (the part of that on a bye) and `asleep_points_lost` (what the best live bench players eligible for the dead slots would have scored, live starters left in place; core `asleepAtWheel`, never negative).

**Definitions that §4.5 left open** (the owner can overrule any of these; each is one line in the catalog or one SQL expression):

- **Dead starter.** A starter whose NFL team had no game that week _and who scored 0_, or whose nflverse roster status is not `ACT`. The "scored 0" part exists because nflverse has no row for a cancelled game (BUF-CIN, 2022 week 17, stopped after a quarter): those players have no game but did score. A missing status counts as active.
- **Unluckiest loss / luckiest win.** Ranked by the weekly score rank (1 = highest, ties share a rank), then by the score (a higher losing score is unluckier, a lower winning score luckier). "Bottom 3" is simply the top of the luckiest list. A head-to-head loss with the top score can't happen, so the list starts at rank 2.
- **Should've won.** A loss whose optimal lineup beats the opponent's _actual_ score (a tie is not a win). Ranked by points left on the bench. **Coulda been a contender.** The team's first playoff loss of the season (its elimination from the title race), when the same test holds. Career versions count them, with the share of the team's losses.
- **All-play luck.** Expected wins = all-play win % x games; luck = actual wins (ties half) minus expected. Regular season, head-to-head wins only, 8-game minimum (the `minGames` filter lowers it).
- **Schedule swap.** Regular season only. Each of your weekly scores is played against the opponent that another team faced that week (skipped when that opponent was you). Best and worst by win %; the schedule's owner is shown.
- **Top / lowest scorer weeks.** The week's highest (lowest) score among the teams with a counted game; ties count for every tied team.
- **One-man show.** `top_player_share`: the best starter's share of starter points. **Boom / bust.** Team: actual score minus the starters' projections (projections exist from 2022). Player: starters only, bye and inactive starters left out. **Biggest upset:** a win with the largest projected deficit. **Era-adjusted:** the weekly z-score.
- **Close games and blowouts.** Margin under 5 (strict) and over 50, head-to-head wins and losses; four career records.
- **Rivalries.** Franchise pairs, head-to-head games in the chosen scope. Most-played, most lopsided (win % with at least 6 games) and the longest win streak (a tie ends a streak), all across seasons. The first team listed is the one with more wins.
- **Seed vs. finish and champions.** Regular-season scope. "Worst record to make the playoffs" and "best record to miss them" use win % (median games per the median filter). Worst champion / best non-champion rank regular-season PF and show all-play %. Seeds are what Sleeper reports.
- **Trajectory.** Most weeks in first place (regular season) by a team that didn't win the title. Biggest fall: first place after the last regular-season week (or after any week in the weeks filter) and the worst finish.
- **Droughts and streaks.** Runs of consecutive completed seasons: without a title, with a playoff trip, with a toilet bowl game. Every franchise is listed, with a run of 0 if it never did.
- **Best waiver pickup / best $ value / FAAB per point.** Successful waiver claims only (not free agents). Starter points are the player's points as a starter for the claiming team from the claim week to the end of that stint (`player_tenure`). $ value uses bids of at least $1; "$ per point" counts a claim that scored under one point as one.
- **Drop regret.** Starter points scored for other teams after a drop, rest of that season only. **Trade winner.** Starter points the players a side received scored for it until the stint ended; "best trade" ranks sides, "most lopsided" ranks trades (best side minus worst side, only trades where at least two sides received players).
- **Journeyman** (all-time: distinct franchises; season: distinct teams in one season), **loyalty** (consecutive league weeks with one franchise, counting across seasons, so the last week of 2024 and the first of 2025 are adjacent) and **boomerang** (the longest gap between two stints of one player on one franchise).
- **Draft steal / bust.** Within one draft, QB / RB / WR / TE only: the pick's place in draft order minus where the player's season points (any team, any slot) ranked among those picks. "By round" became **best pick of each round** (one row per round). **Auction value:** season points per dollar (price of at least $1) and its reverse, dollars per point. **Draft class:** starter points a team got from the players it drafted that season, while it had them.
- **NFL game stack.** Starter points from players in one NFL game (needs `nfl_game_id`). **Bye-week survivor:** the highest score with at least two starters on a bye. **Heaviest bye week survived:** the most starters on a bye in a game the team won.

- **Median splits** (owner decision): "won the game, lost the median" and "lost the game, won the median", for seasons with the median on, ranked by the gap between the team's score and the week's median. This replaces the contradictory "lost to the median with a 2nd-place score" item.
- **Auction bust:** one player's auction price against his season points (dollars per point, under one point counted as one); confirmed as the intended reading of "most $ spent on the worst finisher".

**Verification.** `apps/api/test/records-extra.test.ts` checks 92 cases against the fixture leagues with every expected value worked out by hand (luck, all-play, schedule swap, champions, rivalries and streaks, draft value, pickups, loyalty) and runs every new record under four filter sets. A second fixture world is hand-edited (bye, inactive, cancelled game, a big bench score) and re-derived to check the bye and regret records. On the dev data, asleep-at-the-wheel (one team-week by hand), drop regret and trade value (against separate SQL) matched. `pnpm --filter @rfp/api sweep-records` runs every record with seven filter sets against the dev database (1,918 runs, none failing, the slowest 450 ms); `show-record <id>` prints one record's top rows.

**Weighted placement (owner decision, 2026-10-07).** The Career Placements tables show `placePct` ("Weighted Placement") instead of the raw average placement. Each completed season counts as `(teams - place) / (teams - 1)` (champion 100%, last 0%; `teams` is the season's team count), so a 2nd of 14 beats a 2nd of 9, and the record "Highest average placement" ranks by the average of that over the seasons played. There is no minimum number of seasons; a one-season manager can rank high. A tenure-aware "power ranking" is a possible later record (see `TODO_TASKS.md`).

**Power rating (owner decisions, 2026-10-07).** `career.power` (section Power Rankings, `version` 2) rates every manager in three steps; code in `packages/core/src/elo.ts` (pure) and `apps/api/src/records/engines/power.ts` (queries). The numbers below are the defaults in `DEFAULT_ELO` / `DEFAULT_POWER`; changing one means bumping the record's `version`.

1. **Elo.** Over every counted head-to-head game of the selected seasons (regular season, playoffs and toilet bowl; 2020's two-week games as one game). Everyone starts at 1500 and games run by season and week (a week's games use the ratings from its start). Each game moves the two ratings by `32 x margin factor x (result - expected)`. The margin factor is half the result and half the margin: `1 + 0.5 x (m - 1)` where `m = ln(1 + margin / 10) / ln(4.1)` (averages about 1) times `2.2 / (0.001 x the winner's rating lead + 2.2)` (a favourite winning big counts less). **Playoff wins** and **toilet-bowl losses** count 1.5x (only the winner's gain / only the loser's loss), and each team also plays **the week's median** (its score against the median score, versus the average rating of that week) at half weight, **in every season, whether or not the league played with medians then** (owner decision; median games are not counted as games). The weighted extras and the median games are zero-sum: whatever they add beyond a plain game is taken back evenly from the managers who played that week. A manager who has already played but has no game in a season fades 25% of the way toward **1387.5** for that season, so sitting out always costs rating; seasons before a manager's first game are not counted against them.
2. **Adjustments.** *Consistency:* the sample standard deviation of a manager's season-average margins, for managers with at least three seasons, compared with the median such manager; each point above costs 0.75 rating points (below: gains), shrunk by n / (n + 2). *Placement:* every completed season adds `40 x (weighted placement - 0.5)` (a title is +20, last place -20) and the career sum is multiplied by 1.5 (older seasons count too). Weighted placement is `(teams - place) / (teams - 1)`.
3. **Blend and scale.** The adjusted Elo and the career average weighted placement (shrunk toward 50% by n / (n + 2)) are z-scored and blended 75 / 25, then shown as `1500 + 250 x z`. The z-scores use the **league's full history** even when a Seasons filter is applied (the record has `readsAllSeasons`, so its cache key covers every season), so a one-season view keeps its natural, narrower spread. The top can pass 2000 and the bottom can pass below 1000: the scale is by standard deviation, not clamped.

Ownership follows the franchise (current manager). The in-progress season is included and the row is flagged. Shown as the rating, win % (head-to-head, ties half), the average weighted placement, games, seasons played and missed seasons. Experiments that led here (new-manager start at the league average and a first-season boost were tried and dropped, they barely moved anything) are in `docs/TODO_TASKS.md`.

**Point differential records (owner request, 2026-10-07).** Four manager records in the section Point Differential, all from one query over each franchise's head-to-head games (points for minus points against, so a win is positive): `career.diff.avg` (highest average), `career.diff.min` (worst single game, the most negative, ranked most negative first), `career.diff.max` (best single game) and `career.diff.stddev` (sample standard deviation, highest = most volatile; needs two games). Median games and 2020's two-week playoff games are not single matchups and are left out (like the close-game and blowout records). The Seasons and Scope filters apply.

#### 3.11.4 ESPN scraper and importer as built (M9)

**Scraper** (`apps/scraper`, run on the owner's desktop). `pnpm scrape:espn --year 2021` tries the league without a login; for a private league it opens the installed Google Chrome (headed, persistent profile `.espn-profile`, or `--profile <dir>` to use another ESPN account) and waits until the `espn_s2` and `SWID` cookies exist, i.e. until you have logged in by hand. Nothing about the credentials is read or stored. League ids are in `src/leagues.ts` (redraft 2020 `79321063`, 2021 `50111898`). Requests are one at a time with a 1.2 s pause and backoff on 429 / 5xx; an existing bundle is never overwritten without `--force`; a failure saves a `.partial` bundle.

What it asks for is what ESPN's own pages ask for, found with `pnpm scrape:espn discover` (it records the API calls the pages make while you click around). This replaced the guesses in §5 step 3:

| Request | Gives |
| --- | --- |
| `mSettings`, `mTeam`+`mStandings`, `mMatchupScore`, `mDraftDetail` (once) | settings, scoring rules, teams, owners (SWIDs), final ranks, the whole schedule with `playoffTierType` (bracket), the draft |
| `mBoxscore`+`mMatchupScore` and `mTransactions2` per week | matchups and totals, the week's transaction feed |
| `mRoster` per team and week (`forTeamId`, `scoringPeriodId`, header `x-fantasy-filter` = the team page's player filter) | the roster as of that week: slot, **actual (stat source 0) and projected (source 1) points per player**, also for teams with no game |
| `kona_playercard`, 40 players a request, repeated until no new player turns up | transactions per player (the feed is incomplete for older seasons; the same record rides on every player it touches) |
| `players_wl` | the season's player list |

Output: `apps/scraper/bundles/<league>-<year>.json.gz` (validated with the server's import schema) and the data-gap report (`pnpm scrape:espn report <bundle>` re-runs it). Keep copies of the bundles in the S3 bucket.

**Importer** (`apps/ingest/src/espn`). The admin upload (`POST /api/admin/import/espn`) archives the bundle verbatim in `raw_payload` and queues the `import-espn` job; `pnpm ingest espn <bundle>` does the same from the command line. The job normalizes the newest stored bundle for the season **in place**: the season, team and franchise rows made by the Mongo migration keep their ids (so corrections, trophies and franchise links survive), then derive runs. `recompute` with `renormalize` re-imports an ESPN season from its stored bundle. Re-running is idempotent. What it does:

- **Season:** takes `externalId` (the placeholder `mongo:` id becomes the ESPN league id), weeks, playoff teams, lineup slots (ESPN slot ids mapped to the solver's slot names), bench / IR sizes, the data flags (player data, projections, transactions, draft; `faab` when the league uses a budget) from ESPN.
- **Teams:** ESPN team -> existing team season by team name (case and spacing ignored), falling back to the configured final place; if a team can't be matched the import stops and lists both sides rather than guess. ESPN owner ids (SWIDs) are recorded as manager identities.
- **Games and brackets:** the winners bracket and its consolation ladder are `playoffs`, the losers ladder is `toilet_bowl`, other weeks `regular`. A one-sided playoff matchup is a bye (a team-week that doesn't count, scored from `pointsByScoringPeriod`). The place a last-week game decides comes from ESPN's own final ranks (winners side: the better rank; toilet bowl: N + 1 - the worse rank), so derive's bracket placement can be compared with ESPN's rank, and with the hand-entered legacy placements, which still win when active.
- **Lineups:** one `player_week` per roster entry (starter / bench / IR, actual and projected points). `nfl_team` and `nfl_game_id` are left for the NFL reference job, which the import job runs.
- **Players:** matched by ESPN id (`player.espn_id`); a D/ST by its NFL team (ESPN id `-(16000 + pro team id)`). Players that don't match are created with their ESPN id and name and put in the admin's unmatched queue.
- **Transactions:** executed and failed claims (`WAIVER`), free-agent adds, plain drops (`ROSTER`), and trades (the `TRADE_ACCEPT` record that carries the moves). Votes, proposals, declines and lineup moves are not transactions. Anything not executed (failed, canceled, still pending at season end) is stored as failed and never counted (doc §2).
- **Draft:** snake or linear by whether round two runs the other way (ESPN calls an offline draft "OFFLINE"); the board slot is mirrored in even rounds of a snake draft, and the original owner of a slot is whoever held it in round one.
- **Report:** counts, unmatched players, weeks where the schedule's score and the starters' sum disagree, and teams whose stored final place differs from ESPN's rank.

**Two-week playoff matchups (owner decision, 2026-10-07; ESPN 2020).** In 2020 the playoffs ran as two-week matchups (matchup period 14 = scoring periods 14-15, period 15 = 16-17; the combined score decides). Each is **one game** in "week 14" / "week 15" with the combined score (`matchup.span_weeks` = 2, migration 0005; the `rec_*` views expose it, migration 0006). The result counts everywhere results and totals count (W-L, PF / PA, standings, final places, head-to-head). It is **left out of single-game records** (highest / lowest score, blowouts and margins, weekly top / bottom scorer, era-adjusted, unlucky and lucky games, the high-scorer and benchwarmer clubs) because a two-week total isn't comparable with a one-week score. **No lineups are stored for those weeks**, so lineup records (potential, bench, player records) skip them too. The Matchups page marks them "2-week game". A season's `last_week` is the last matchup period (15 for 2020), not the last scoring period.

**Nine teams (2020).** With an odd number of teams one team has no game each week (a bye, scored from the sum of `pointsByScoringPeriod`). Like a playoff bye, it is a team-week that doesn't count ("scores that didn't count"); it has no result. This replaces the old note that its score was unknown.

**Other import rules found on 2020.** League votes on a trade (`TRADE_VETO`, like `TRADE_UPHOLD`) are not transactions; a trade with votes against it still went through on the rosters, so it is kept. A starter whose default position differs from the slot he started in (a QB at TE) is eligible for that slot, as on Sleeper.

**Results on the real bundles.** 2021: 12 teams, 84 regular + 8 playoff + 9 toilet-bowl games, 204 team-weeks, 3,316 lineup entries, 415 transactions (81 not executed), 192 draft picks. All 301 players matched (no queue), no score mismatches, the brackets reproduce both the legacy placements and ESPN's ranks, and no lineup anomalies. 2021 now has lineup, projection, transaction and draft records and pages. 2020: 9 teams, 52 regular + 4 playoff + 4 toilet-bowl games (two-week playoffs), 153 team-weeks, 1,900 lineup entries (the one-week weeks), 339 transactions (62 not executed), 144 draft picks; all 240 players matched, no mismatches.

## 4. Record catalog

Legend:

- **Grain:** see §3.3.
- **Filters:** `Sn` = seasons, `Sc` = scope, `Pos` = positions, `Slot` = starter/bench/IR/taxi, `NZ` = exclude zeroes, `1/S` = one per season.
- **Active:** `inc` = partial season included, `flag` = included but marked in progress, `cmp` = completed seasons only.
- **Needs:** data needed beyond the matchup scores, which every record uses.

### 4.1 Trophies

| Trophy             | Definition                                                                                     | Needs              |
| ------------------ | ---------------------------------------------------------------------------------------------- | ------------------ |
| Winners Circle     | `final_place = 1`                                                                              | final placements   |
| Podium Finishers   | `final_place in (2, 3)`                                                                        | final placements   |
| Losers Circle      | `final_place = team_count`                                                                     | final placements   |
| High Scorer's Club | any counted team-week with `points > league_threshold.high_scorer` (redraft 190 / dynasty 200) | `league_threshold` |
| Benchwarmer's Club | any counted team-week with `points < league_threshold.benchwarmer` (redraft 65 / dynasty 90)   | `league_threshold` |

Trophies are a derived `trophy` table (`kind`, `team_season_id`, `team_week_id?`, `value`), rebuilt during `finalize`. The trophy case and the threshold clubs read from it.

### 4.2 Overall records (single event)

| Record                                                                         | Grain                         | Filters           | Active | Needs                                             |
| ------------------------------------------------------------------------------ | ----------------------------- | ----------------- | ------ | ------------------------------------------------- |
| Highest / lowest score                                                         | team_week                     | Sn Sc             | inc    | —                                                 |
| Largest blowout / narrowest win                                                | team_week (winner side)       | Sn Sc             | inc    | —                                                 |
| Highest / lowest potential points (with actual points)                         | team_week                     | Sn Sc             | inc    | player_week (all rostered), position snapshot     |
| Highest $ on a single waiver claim                                             | transaction_item              | Sn                | inc    | FAAB bids (`has_faab`)                            |
| Highest $ on a single draft pick                                               | draft_pick                    | Sn                | inc    | auction amounts (`has_auction_draft`)             |
| Player highest score / non-zero lowest score / benched highest / roster lowest | player_week                   | Sn Sc Pos Slot NZ | inc    | player_week incl. BN/IR, slot + position snapshot |
| Most moved player                                                              | player × (season or all-time) | Sn                | inc    | transactions incl. drops, status                  |
| Broadest trade (# teams) / largest trade (# players)                           | transaction                   | Sn                | inc    | trade items                                       |
| Biggest benchwarmer (most bench points, season)                                | player_season (per team)      | Sn Pos            | flag   | player_week BN                                    |
| Best score that didn't count (team) + best player on it                        | team_week `counts = false`    | Sn                | inc    | `team_week` rows for no-game weeks                |

The player records are six records (roster, starters only and bench only, each highest and lowest); the slot is fixed by the record, and position / `NZ` are filters (owner decision, §3.5.1).

### 4.3 Single-season records (season is a column; `1/S` toggles "season max")

| Record                                                     | Grain         | Filters       | Active                             | Columns                                                                                        |
| ---------------------------------------------------------- | ------------- | ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| Highest / lowest PF, highest / lowest PA                   | team_season   | Sc 1/S        | highest: flag, lowest: cmp         | team/manager, season, points                                                                   |
| Most wins / most losses                                    | team_season   | Sc median 1/S | most wins: flag, most losses: flag | record W-L-T, points                                                                           |
| Highest / lowest win %                                     | team_season   | Sc median 1/S | cmp                                | win %, record W-L-T                                                                            |
| Highest / lowest lineup IQ                                 | team_season   | Sc 1/S        | cmp                                | IQ, PF, potential PF                                                                           |
| Player highest season score                                | player_season | Sc Pos 1/S    | flag                               | player, season, position, team(s); best and worst game (week + manager), PPG, PPG excl. zeroes |
| Most / fewest trades                                       | team_season   | 1/S           | most: flag, fewest: cmp            | trades                                                                                         |
| Most / fewest waiver claims                                | team_season   | 1/S           | most: flag, fewest: cmp            | claims                                                                                         |
| Most / least $ on waiver claims                            | team_season   | 1/S           | most: flag, least: cmp             | claims, total $ (`has_faab`)                                                                   |
| Highest / lowest % of drafted players kept to season's end | team_season   | 1/S           | cmp                                | % (`player_tenure`)                                                                            |

`player_season` is per **(player, team season)** by default, so a player who was traded shows up for each team. A "whole league" toggle sums across teams, and the team column then lists every team he played for.

### 4.4 Manager (franchise) records

| Record                                                                                             | Grain            | Filters      | Active | Notes                                                         |
| -------------------------------------------------------------------------------------------------- | ---------------- | ------------ | ------ | ------------------------------------------------------------- |
| W/L: years, W, L, T, win %, longest W/L streak (+ seasons)                                         | franchise_career | Sn Sc median | inc    | streaks per season; ties list every holding season            |
| Placements: playoff and toilet bowl appearances, highest, lowest and average placement (+ seasons) | franchise_career | Sn           | cmp    |                                                               |
| Transactions: # trades, # waiver claims, $ spent                                                   | franchise_career | Sn Sc        | inc    | Sc uses the transaction week's game type for that team (§3.4) |
| Scoring: highest and lowest score (+ week), PF, PA, games, avg PF, avg PA                          | franchise_career | Sn Sc        | inc    |                                                               |
| Lineups: perfect lineups, missed points, lineup IQ                                                 | franchise_career | Sn Sc        | inc    | perfect = optimal − actual < 0.01                             |

### 4.5 Additional records (accepted)

All accepted, and all built in M8 (§3.11.3 says how each is defined). They're grouped by data cost. Everything in the first group runs on data the schema above already has.

**No new data**

- **Unluckiest loss:** lost while having the 2nd-highest (or Nth-highest) score of the week. And its mirror, **luckiest win**: won with a bottom-3 score.
- **Should've won:** losses where your _optimal_ lineup would have beaten the opponent's actual score. Counted per franchise, plus the single worst one ("left X points on the bench in a 2-point loss").
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

- **Best waiver pickup:** points scored _as a starter_ for the team after acquiring the player, rest of season.
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


---

## 5. ESPN data contract (for the later Playwright scraper)

> **As built (M9):** see §3.11.4. The requests in step 3 below are what ESPN's own pages turned out to use, not the guesses first listed here.

The scraper must fill the same canonical tables Sleeper does. For each ESPN season we need:

| Data                                                                                                                                                                     | Needed for                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| League settings: roster slots, bench/IR sizes, scoring settings, regular-season weeks, playoff teams, playoff start week, median setting, losers bracket on/off          | game types, optimal lineups, projections                                  |
| Teams + owners (SWIDs) + team names/avatars + divisions                                                                                                                  | manager identity, franchises                                              |
| Weekly matchups with both teams' points, **plus every team's score in weeks it had no game** (playoff byes, eliminated teams)                                            | everything; "scores that didn't count"                                    |
| Per-week box scores: **every rostered player** (starters, bench, IR), lineup slot, actual points, projected points, the player's position / eligible positions that week | potential points, lineup IQ, player records, benchwarmer, `player_tenure` |
| Playoff bracket: winners and losers bracket games, **including placement games**, and the placement each one decides                                                     | scopes, placements                                                        |
| Final standings / placements                                                                                                                                             | placement records, trophies                                               |
| Transactions: trades (players, picks, FAAB), waivers with FAAB bids and **status (won / failed)**, free-agent adds, drops, each with week + timestamp                    | transaction records, most moved, tenure                                   |
| Draft: picks, order, auction amounts, keepers                                                                                                                            | draft records, retention %                                                |
| Team names / avatars as of that season                                                                                                                                   | display                                                                   |

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

**Status (2026-10-07): all seven steps are done** (milestones M0-M9; "as built" notes in §3.2.1, §3.5.1, §3.6.1, §3.9.1, §3.11.1-§3.11.4). What remains is the cutover: [`cutover.md`](cutover.md).

1. `packages/db` schema + migrations. `packages/core` compute, with tests for every issue in §1.4 and the decisions in §2.
2. Sleeper ingest (league, users, rosters, matchups, **brackets**, **transactions**, **drafts**, projections) and the derive step. **One-time Mongo migration script** (`pnpm migrate:mongo`) copies the cached ESPN seasons and the config document into the new tables. Mongo stays read-only until cutover, then gets shut down.
3. Record engine. Port the ~30 existing records and compare against the current site, accounting for the known bugs.
4. NFL reference data (§3.8): schedule, weekly rosters, ID crosswalk, backfilled for every season we have.
5. API, then the new UI, including the admin UI (§3.9). Auth and admin config ship before anyone outside can reach the site: the config tables replace the Mongo config document, so the admin UI is how config gets edited from then on.
6. ESPN data contract audit + Playwright scraper.
7. The new records (§4).

## 7. Open items (answered during M3, 2026-10-05, from real data)

- **What Sleeper returns in playoff weeks for teams with no bracket game.** `matchup_id` is `null` and the entry carries a real `points` value. Idle teams must never be grouped into a game (`pairWeek` pairs only ids shared by exactly two teams). Those weeks are stored as `team_week` rows with `counts = false`, so "scores that didn't count" works for Sleeper. Sleeper also serves matchups for weeks after the season (e.g. week 18: all `matchup_id: null`, with scores); ingest stops at `last_week` (the playoff start plus the bracket's rounds, minus 1).
- **Sleeper's `p` field and the bracket shape.** Verified on 2022-2025 (all `playoff_round_type = 0`, one round per week, round `r` is played in week `playoff_week_start + r - 1`; `t1`/`t2` are roster ids once known).
  - The _winners_ bracket also contains consolation games among teams eliminated in round 1. `p` appears only on the games that decide a place: `p:1` the final, `p:3` the semifinal losers, `p:5` the round-1 losers, and so on. Games without `p` have no placement at stake (the loser simply takes the next open place).
  - The _losers_ bracket is a consolation bracket for the teams that missed the playoffs, played for **last place**: the **lower** scorer is Sleeper's "winner" (`w`) and advances. `p:1` is the game that decides last place, so the lower scorer takes place `N`, the higher `N - 1`; `p:3` decides `N - 2` / `N - 3`, and so on. This reproduces the legacy hand-entered placements for 2024 redraft exactly. `derivePlacements` (core) implements it.
  - `matchup.bracket` / `bracket_round` / `placement_at_stake` / `is_championship` come from this. Every Sleeper playoff-week game in the five seasons we hold matched a bracket entry (no `game_type = 'none'` games from Sleeper), so scopes work from the brackets alone.
- **Bracket placements vs the legacy hand-entered placements.** They agreed for 2024 redraft and dynasty and differed by one adjacent pair in three seasons (2022 redraft 7th/8th, 2023 redraft 5th/6th, 2023 dynasty 5th/6th). The owner confirmed the hand-entered values were wrong, so **the brackets win for every Sleeper season**. The legacy values are kept as _inactive_ `final_place` overrides for reference. An _active_ override (an admin's, or the imported ones for the ESPN seasons, which have no brackets) still beats the brackets.
- **ESPN seasons in the Mongo cache (2020, 2021). Superseded by M9 (§3.11.4): both seasons are now imported from scraped bundles, with lineups, projections, transactions, drafts and brackets.** What the cache held: Only weekly matchup scores per team, plus the configured final placements and playoff-qualified teams. No player data (so no lineup/potential/bench records), no projections, no transactions, no draft, no brackets, no median setting, and no scores for teams without a game. 2020 has 9 teams, so one team is missing from every week's schedule (its score is unknown). Consequence: their playoff-week games have no bracket entry, so they are `game_type = 'none'` (doc §2) until the ESPN scraper (§5) brings brackets (decided: the brackets will be scraped, not inferred). All `has_*` flags are false for these seasons.
- **Sleeper re-serves past weeks with the _current_ scoring, and `finalize`.** Re-fetching a past week can therefore change numbers. `finalize` re-fetches the season (`force`), normalizes with upserts (matchup and team-week ids stay stable) and re-derives; derived tables are wiped and refilled in one transaction, so it is safe to re-run. Verified: two forced re-runs left every derived row identical.
- **Why Sleeper's own roster totals differ from the served matchup points (dynasty 2023 and 2025).** Investigated with Sleeper's stats endpoint (`GET /v1/stats/nfl/regular/{season}/{week}`: raw stat lines per player).
  - Recomputing every rostered player's points from those stats and the league's _current_ scoring settings reproduces the served matchup points exactly (0 differences over all rostered player-weeks, 2023 weeks 1-14). So the matchup numbers are correct for today's scoring.
  - **Dynasty 2023 (explained, and fixed in the data):** Sleeper's roster totals (`fpts`) were 14-22 PF higher per team. The gap tracks the starting quarterbacks' interceptions: the league played weeks 1-13 with `pass_int = -1` and changed it to **-2 from week 14** (the current setting). Sleeper keeps the standings it computed at the time but serves old matchups under today's scoring. Re-scoring weeks 1-13 at -1 reproduces Sleeper's official W-L **and PF for all 10 teams exactly**. Two week-12 games flip as a result: _Purdy fly for a white guy_ beats _Team ZekNikZ_ (122.86-121.52, served 117.86-118.52) and _breeces pieces_ beats _The Jackson 31_ (189.38-188.44, served 188.38-188.44).
  - **Dynasty 2025:** Sleeper's totals are 0-3.5 PF higher per team, with no W-L difference; PF and PA both net +19.0, so the differences sit in specific games. No single scoring stat (or pair or triple) fits the gaps and there are no commissioner adjustments. The owner checked the three candidate games on the Sleeper site (weeks 5, 7 and 14 against _Running Back Heaven_) and found nothing. It stays an accepted, unexplained discrepancy that cannot change any result; records use the served points.
  - **As-played scoring (owner decision, 2026-10-06):** a season's standings and every record use the scoring that applied when it was played. `league_season.scoring_overrides` holds rules (`{ stat, points, fromWeek?, toWeek? }`); during normalize, player, starter and team points are re-scored from Sleeper's raw stats (`GET /v1/stats/nfl/regular/{season}/{week}`, cached in `raw_payload`) by the per-player delta (units x (as-played - current points per unit)). Only dynasty 2023 has a rule (`pass_int` = -1, weeks 1-13); it is seeded by `migrate:mongo` and editable in the admin UI (M6). Seasons without rules are unchanged.
- **Per-week player position and eligibility.** Sleeper has no per-week position or eligibility. The snapshot keeps nflverse's position for that week unless it conflicts with Sleeper's fantasy view (found in real data: nflverse lists a running back as a DB through an ID collision, and a QB who is TE-eligible on Sleeper); then Sleeper's position wins. Eligibility is the union of both plus the slot a starter actually filled. The legacy used today's position only. Result: no team-week anywhere has an actual lineup better than its computed optimum.
- **`REC_FLEX` is WR/TE, not RB/WR.** The legacy mapped it as RB/WR (and IDP positions loosely). Real lineups settle it: across the league's history the `REC_FLEX` starters are 111 TEs and 59 WRs and no RBs. `SLOT_ELIGIBILITY` in core uses WR/TE.
- **IR / taxi history.** Sleeper's matchup payload lists every rostered player but no IR/taxi split, so historical non-starters are `bench`. IR and taxi (`slot_kind`) exist only for the live roster (`roster_current`).
