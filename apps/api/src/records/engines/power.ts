import { computeElo, winChance, type EloGame } from "@rfp/core";
import { sql } from "@rfp/db";
import { seasonCond, type RankedRow, type RunContext } from "../context";
import { rankRows } from "../rank";

/**
 * Power rating (doc §3.11.3): an Elo rating over every counted head-to-head game of the selected seasons, with the
 * margin of victory counted and a fade for seasons a manager sat out (see packages/core/src/elo.ts). The rating is
 * computed here from the games and handed to the ranking query as a JSON table.
 */
export async function careerPowerRecord(ctx: RunContext): Promise<RankedRow[]> {
  const res = await ctx.db.execute<{
    season: number;
    week: number;
    a: number;
    b: number;
    pa: number;
    pb: number;
    live: boolean;
  }>(sql`
    select a.season, a.week, a.franchise_id as a, b.franchise_id as b,
           a.points::float8 as pa, b.points::float8 as pb, (ls.status <> 'complete') as live
    from rec_team_week a
    join rec_team_week b on b.matchup_id = a.matchup_id and a.team_season_id < b.team_season_id
    join league_season ls on ls.id = a.league_season_id
    where a.counts and b.counts and a.points is not null and b.points is not null
      and ${seasonCond(sql`a.league_season_id`, ctx.seasonIds)}`);

  const games: EloGame[] = res.rows.map((r) => ({
    season: Number(r.season),
    week: Number(r.week),
    a: Number(r.a),
    b: Number(r.b),
    pointsA: Number(r.pa),
    pointsB: Number(r.pb),
  }));
  const live = new Set<number>();
  for (const r of res.rows)
    if (r.live) {
      live.add(Number(r.a));
      live.add(Number(r.b));
    }

  const table = computeElo(games).map((e) => ({
    franchise_id: e.franchiseId,
    sort_value: Math.round(e.rating * 1e4) / 1e4,
    rating: Math.round(e.rating),
    win_chance: Math.round(winChance(e.rating) * 1e4) / 1e4,
    games: e.games,
    wins: e.wins,
    losses: e.losses,
    ties: e.ties,
    seasons: e.seasonsPlayed,
    missed: e.seasonsMissed,
    live: live.has(e.franchiseId),
  }));

  const inner = sql`
    select
      t.sort_value::float8 as sort_value,
      0 as season, t.franchise_id,
      jsonb_build_object(
        'rating', t.rating, 'winChance', t.win_chance, 'games', t.games, 'wins', t.wins,
        'losses', t.losses, 'ties', t.ties, 'seasons', t.seasons, 'missed', t.missed
      ) as data,
      jsonb_build_object('franchiseId', t.franchise_id) as refs,
      t.live as in_progress,
      lpad(t.franchise_id::text, 6, '0') as tie_key
    from jsonb_to_recordset(${JSON.stringify(table)}::jsonb) as t(
      franchise_id int, sort_value float8, rating int, win_chance float8, games int, wins int,
      losses int, ties int, seasons int, missed int, live boolean
    )`;
  return rankRows(ctx, inner);
}
