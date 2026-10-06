import { leagueSeason, and, eq, sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { scopeCond, seasonCond, inList, type RankedRow } from "../records/context";
import { resolveRows, type Entities } from "../records/entities";
import { recordQuerySchema, selectSeasons, type MedianMode, type Scope } from "@rfp/core";

/** Seasons of a league selected by a `seasons` query value, newest data last. */
export async function selectedSeasons(db: Db, leagueId: number, raw: unknown) {
  const all = await db
    .select()
    .from(leagueSeason)
    .where(and(eq(leagueSeason.leagueId, leagueId), eq(leagueSeason.enabled, true)));
  const seasons = recordQuerySchema.shape.seasons.parse(raw ?? "all");
  const years = selectSeasons(
    seasons,
    all.map((s) => s.year)
  );
  return all.filter((s) => years.includes(s.year)).sort((a, b) => a.year - b.year);
}

/** Entities (team names, managers) for a set of franchise ids, reusing the record entity resolution. */
export async function franchiseEntities(
  db: Db,
  franchiseIds: readonly number[]
): Promise<Entities> {
  const rows: RankedRow[] = franchiseIds.map((franchiseId) => ({
    rank: 0,
    total: 0,
    value: 0,
    data: {},
    refs: { franchiseId },
    inProgress: false,
  }));
  return (await resolveRows(db, rows)).entities;
}

export interface HeadToHead {
  /** Franchise ids in display order. */
  franchises: number[];
  /** matrix[a][b] = a's results against b. `median` is the pseudo-opponent. */
  matrix: Record<
    number,
    Record<number | "median", { w: number; l: number; t: number; games: number }>
  >;
  entities: Entities;
  seasonsIncluded: number[];
  availableFrom: number | null;
}

/**
 * Franchise x franchise results (heatmap source). Head-to-head rows come from game_result, so ties are ties and the
 * scope follows the brackets; the MEDIAN column counts median games (doc §2) per the median mode.
 */
export async function headToHead(
  db: Db,
  leagueId: number,
  query: { seasons?: unknown; scope: Scope; median: MedianMode }
): Promise<HeadToHead> {
  const seasons = await selectedSeasons(db, leagueId, query.seasons);
  const ids = seasons.map((s) => s.id);
  const matrix: HeadToHead["matrix"] = {};
  if (ids.length === 0) {
    return {
      franchises: [],
      matrix,
      entities: { franchises: {}, teamSeasons: {}, managers: {} },
      seasonsIncluded: [],
      availableFrom: null,
    };
  }
  const bump = (a: number, b: number | "median", result: string, n: number) => {
    const row = ((matrix[a] ??= {} as HeadToHead["matrix"][number])[b] ??= {
      w: 0,
      l: 0,
      t: 0,
      games: 0,
    });
    if (result === "W") row.w += n;
    else if (result === "L") row.l += n;
    else row.t += n;
    row.games += n;
  };
  if (query.median !== "only") {
    const h2h = await db.execute<{ f: number; o: number; result: string; n: string }>(sql`
      select gr.franchise_id as f, gr.opponent_franchise_id as o, gr.result::text as result, count(*) as n
      from rec_game_result gr
      where gr.kind = 'h2h' and gr.opponent_franchise_id is not null
        and ${seasonCond(sql`gr.league_season_id`, ids)} and ${scopeCond(sql`gr.game_type`, query.scope)}
      group by 1, 2, 3`);
    for (const r of h2h.rows) bump(r.f, r.o, r.result, Number(r.n));
  }
  if (query.median !== "exclude") {
    const med = await db.execute<{ f: number; result: string; n: string }>(sql`
      select gr.franchise_id as f, gr.result::text as result, count(*) as n
      from rec_game_result gr
      where gr.kind = 'median' and ${seasonCond(sql`gr.league_season_id`, ids)}
        and ${scopeCond(sql`gr.game_type`, query.scope)}
        and ${query.median === "default" ? sql`gr.median_enabled` : sql`true`}
      group by 1, 2`);
    for (const r of med.rows) bump(r.f, "median", r.result, Number(r.n));
  }
  const franchises = Object.keys(matrix)
    .map(Number)
    .sort((a, b) => a - b);
  return {
    franchises,
    matrix,
    entities: await franchiseEntities(db, franchises),
    seasonsIncluded: seasons.map((s) => s.year),
    availableFrom: seasons[0]?.year ?? null,
  };
}

export type TrophyType =
  | "placement"
  | "high-scorer-club"
  | "benchwarmer-club"
  | "smartypants-club"
  | "season-high-score"
  | "season-narrowest-win"
  | "season-largest-blowout"
  | "season-points-for"
  | "season-points-against"
  | "season-high-iq";

export interface TrophyRow extends TrophyEntry {
  managerId: number | null;
  opponentManagerId: number | null;
}

export interface TrophyEntry {
  type: TrophyType;
  season: number;
  franchiseId: number;
  teamSeasonId: number;
  week: number | null;
  /** Place (placement trophies), points, margin or IQ, depending on the type. */
  value: number;
  opponentTeamSeasonId: number | null;
  opponentPoints: number | null;
}

/**
 * The trophy case (legacy trophies.ts, fixed): placement trophies (winners circle, podium, losers circle), the
 * High Scorer's / Benchwarmer's / Smartypants clubs, and each season's superlatives. Season points for / against are
 * the true totals over counted games (doc §1.4 bug 3: the legacy code summed only winners' scores for PF and the
 * loser's *own* score for PA). Ties for a superlative all get the trophy. Only completed seasons award trophies.
 */
export async function trophyCase(db: Db, leagueId: number, query: { season?: number }) {
  const seasons = (
    await selectedSeasons(db, leagueId, query.season === undefined ? "all" : String(query.season))
  ).filter((s) => s.status === "complete");
  const ids = seasons.map((s) => s.id);
  const entries: TrophyEntry[] = [];
  const empty: TrophyRow[] = [];
  if (ids.length === 0)
    return {
      trophies: empty,
      entities: await franchiseEntities(db, []),
      availableFrom: null,
      seasonsIncluded: [] as number[],
    };

  type Row = {
    type: TrophyType;
    season: number;
    franchise_id: number;
    team_season_id: number;
    week: number | null;
    value: number;
    opp: number | null;
    opp_points: number | null;
  };
  const seasonScope = seasonCond(sql`tw.league_season_id`, ids);
  const result = await db.execute<Row>(sql`
    with tw as (
      select tw.*, otw.points as opp_points
      from rec_team_week tw
      left join team_week otw on otw.team_season_id = tw.opponent_team_season_id and otw.week = tw.week
      where ${seasonScope}
    ),
    totals as (
      select team_season_id, franchise_id, season, sum(points) as pf, sum(opp_points) as pa from tw
      group by team_season_id, franchise_id, season
    ),
    thr as (
      select coalesce(
        (select value from league_threshold where league_id = ${leagueId} and key = 'smartypants' and league_season_id is null limit 1),
        0.999) as iq
    )
    select 'placement' as type, ls.year as season, ts.franchise_id, t.team_season_id, null::int as week,
           t.value::float8 as value, null::int as opp, null::float8 as opp_points
    from trophy t join team_season ts on ts.id = t.team_season_id join league_season ls on ls.id = ts.league_season_id
    where t.kind in ('winners_circle', 'podium', 'losers_circle') and ${seasonCond(sql`ts.league_season_id`, ids)}
    union all
    select case t.kind when 'high_scorer' then 'high-scorer-club' else 'benchwarmer-club' end, ls.year, ts.franchise_id, t.team_season_id,
           x.week, t.value::float8, x.opponent_team_season_id, x.opp_points::float8
    from trophy t
    join team_season ts on ts.id = t.team_season_id
    join league_season ls on ls.id = ts.league_season_id
    join (select tw.team_week_id, tw.week, tw.opponent_team_season_id, tw.opp_points from tw) x on x.team_week_id = t.team_week_id
    where t.kind in ('high_scorer', 'benchwarmer') and ${seasonCond(sql`ts.league_season_id`, ids)}
    union all
    select 'smartypants-club', tw.season, tw.franchise_id, tw.team_season_id, tw.week, tw.lineup_iq::float8, tw.opponent_team_season_id, tw.opp_points::float8
    from tw, thr where tw.optimal_points > 0 and tw.lineup_iq >= thr.iq
    union all
    select 'season-high-score', season, franchise_id, team_season_id, week, points::float8, opponent_team_season_id, opp_points::float8
    from (select tw.*, max(points) over (partition by season) as mx from tw) x where points = mx
    union all
    select 'season-narrowest-win', season, franchise_id, team_season_id, week, margin::float8, opponent_team_season_id, opp_points::float8
    from (select tw.*, min(margin) over (partition by season) as mn from tw where result = 'W') x where margin = mn
    union all
    select 'season-largest-blowout', season, franchise_id, team_season_id, week, margin::float8, opponent_team_season_id, opp_points::float8
    from (select tw.*, max(margin) over (partition by season) as mx from tw where result = 'W') x where margin = mx
    union all
    select 'season-high-iq', season, franchise_id, team_season_id, week, lineup_iq::float8, opponent_team_season_id, opp_points::float8
    from (select tw.*, max(lineup_iq) over (partition by season) as mx from tw where optimal_points > 0) x where lineup_iq = mx
    union all
    select 'season-points-for', season, franchise_id, team_season_id, null, pf::float8, null, null
    from (select totals.*, max(pf) over (partition by season) as mx from totals) x where pf = mx
    union all
    select 'season-points-against', season, franchise_id, team_season_id, null, pa::float8, null, null
    from (select totals.*, min(pa) over (partition by season) as mn from totals where pa > 0) x where pa = mn
    order by 2, 1, 4`);

  for (const r of result.rows) {
    entries.push({
      type: r.type,
      season: r.season,
      franchiseId: r.franchise_id,
      teamSeasonId: r.team_season_id,
      week: r.week,
      value: Number(r.value),
      opponentTeamSeasonId: r.opp,
      opponentPoints: r.opp_points === null ? null : Number(r.opp_points),
    });
  }
  const refs: RankedRow[] = entries.map((e) => ({
    rank: 0,
    total: 0,
    value: 0,
    data: {},
    refs: {
      franchiseId: e.franchiseId,
      teamSeasonId: e.teamSeasonId,
      opponentTeamSeasonId: e.opponentTeamSeasonId,
      week: e.week ?? undefined,
    },
    inProgress: false,
  }));
  const resolved = await resolveRows(db, refs);
  return {
    trophies: entries.map((e, i) => ({
      ...e,
      managerId: resolved.rows[i]?.refs.managerId ?? null,
      opponentManagerId: resolved.rows[i]?.refs.opponentManagerId ?? null,
    })),
    entities: resolved.entities,
    availableFrom: seasons[0]?.year ?? null,
    seasonsIncluded: seasons.map((s) => s.year),
  };
}

void inList;
