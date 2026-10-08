import {
  computePower,
  type EloGame,
  type GameKind,
  type MedianGame,
  type Placement,
} from "@rfp/core";
import { leagueSeason, and, eq, sql } from "@rfp/db";
import { seasonCond, type RankedRow, type RunContext } from "../context";
import { rankRows } from "../rank";

/**
 * Everything the Power Rating needs from the selected seasons: counted head-to-head games, every team's score against
 * its week's median (in every season, whether or not the league played with medians then), and the final places of
 * completed seasons. `live` is the set of franchises with a game in a season still in progress.
 */
async function loadPowerInput(ctx: RunContext, seasonIds: readonly number[]) {
  const games = await ctx.db.execute<{
    season: number;
    week: number;
    a: number;
    b: number;
    pa: number;
    pb: number;
    kind: string;
    live: boolean;
  }>(sql`
    select a.season, a.week, a.franchise_id as a, b.franchise_id as b,
           a.points::float8 as pa, b.points::float8 as pb, a.game_type::text as kind,
           (ls.status <> 'complete') as live
    from rec_team_week a
    join rec_team_week b on b.matchup_id = a.matchup_id and a.team_season_id < b.team_season_id
    join league_season ls on ls.id = a.league_season_id
    where a.counts and b.counts and a.points is not null and b.points is not null
      and ${seasonCond(sql`a.league_season_id`, seasonIds)}`);
  const medians = await ctx.db.execute<{
    season: number;
    week: number;
    f: number;
    pf: number;
    med: number;
  }>(sql`
    select season, week, franchise_id as f, points_for::float8 as pf, points_against::float8 as med
    from rec_game_result
    where kind = 'median' and ${seasonCond(sql`league_season_id`, seasonIds)}`);
  const places = await ctx.db.execute<{
    season: number;
    f: number;
    place: number;
    teams: number;
  }>(sql`
    select season, franchise_id as f, final_place as place, team_count as teams
    from rec_team_season
    where season_complete and final_place is not null and ${seasonCond(sql`league_season_id`, seasonIds)}`);

  const kinds: Record<string, GameKind> = { playoffs: "playoffs", toilet_bowl: "toilet_bowl" };
  const eloGames: EloGame[] = games.rows.map((r) => ({
    season: Number(r.season),
    week: Number(r.week),
    a: Number(r.a),
    b: Number(r.b),
    pointsA: Number(r.pa),
    pointsB: Number(r.pb),
    kind: kinds[r.kind] ?? "regular",
  }));
  const medianGames: MedianGame[] = medians.rows.map((r) => ({
    season: Number(r.season),
    week: Number(r.week),
    franchiseId: Number(r.f),
    points: Number(r.pf),
    median: Number(r.med),
  }));
  const placements: Placement[] = places.rows.map((r) => ({
    season: Number(r.season),
    franchiseId: Number(r.f),
    place: Number(r.place),
    teamCount: Number(r.teams),
  }));
  const live = new Set<number>();
  for (const r of games.rows)
    if (r.live) {
      live.add(Number(r.a));
      live.add(Number(r.b));
    }
  return { input: { games: eloGames, medians: medianGames, placements }, live };
}

/**
 * Power rating (doc §3.11.3): the Elo over every counted head-to-head game, adjusted for consistency and final
 * placements, blended with the average weighted placement and put on a display scale (see packages/core/src/elo.ts).
 * The scale is calibrated on the league's full history, so a Seasons filter shows a narrower spread rather than being
 * stretched. The result is handed to the ranking query as a JSON table.
 */
export async function careerPowerRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { input, live } = await loadPowerInput(ctx, ctx.seasonIds);

  const all = await ctx.db
    .select({ id: leagueSeason.id })
    .from(leagueSeason)
    .where(and(eq(leagueSeason.leagueId, ctx.leagueId), eq(leagueSeason.enabled, true)));
  const allIds = all.map((s) => s.id);
  const selectedAll = allIds.every((id) => ctx.seasonIds.includes(id));
  const calibration = selectedAll
    ? undefined
    : computePower((await loadPowerInput(ctx, allIds)).input).calibration;

  const table = computePower(input, undefined, calibration).rows.map((e) => ({
    franchise_id: e.franchiseId,
    sort_value: Math.round(e.rating * 1e4) / 1e4,
    rating: Math.round(e.rating),
    win_pct: e.winPct === null ? null : Math.round(e.winPct * 1e4) / 1e4,
    place_pct: e.placePct === null ? null : Math.round(e.placePct * 1e4) / 1e4,
    games: e.games,
    seasons: e.seasonsPlayed,
    missed: e.seasonsMissed,
    live: live.has(e.franchiseId),
  }));

  const inner = sql`
    select
      t.sort_value::float8 as sort_value,
      0 as season, t.franchise_id,
      jsonb_build_object(
        'rating', t.rating, 'winPct', t.win_pct, 'placePct', t.place_pct, 'games', t.games,
        'seasons', t.seasons, 'missed', t.missed
      ) as data,
      jsonb_build_object('franchiseId', t.franchise_id) as refs,
      t.live as in_progress,
      lpad(t.franchise_id::text, 6, '0') as tie_key
    from jsonb_to_recordset(${JSON.stringify(table)}::jsonb) as t(
      franchise_id int, sort_value float8, rating int, win_pct float8, place_pct float8, games int,
      seasons int, missed int, live boolean
    )`;
  return rankRows(ctx, inner);
}
