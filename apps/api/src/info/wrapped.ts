import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import type { ColumnType } from "@rfp/core";
import { HttpError } from "../lib/http";
import { runRecord } from "../records/run";
import {
  describeTeams,
  runSpec,
  topHighlights,
  type Highlight,
  type HighlightSpec,
  type TeamRef,
} from "./highlights";

/** Where a franchise's season stood among the league's teams for one season record. */
export interface WrappedRank {
  key: string;
  label: string;
  rank: number;
  of: number;
  value: number;
  valueType: ColumnType;
}

export interface WeekLine {
  week: number;
  gameType: string;
  points: number;
  opponentPoints: number | null;
  opponent: string | null;
  result: string | null;
  /** Optimal lineup minus actual lineup, when the week has lineups. */
  left: number | null;
}

/** The season records a wrapped ranks the team on (the whole league's rows, read for that one season). */
const RANKED: readonly { id: string; key: string; label: string; flip?: boolean }[] = [
  { id: "season.pf.high", key: "pf", label: "Points scored" },
  { id: "season.allplay.high", key: "allplay", label: "All-play win %" },
  { id: "season.luck.high", key: "luck", label: "Luck (wins above all-play)" },
  { id: "season.sos", key: "sos", label: "Strength of schedule" },
  { id: "season.score.stddev", key: "volatility", label: "Weekly score swings" },
  { id: "season.iq.high", key: "iq", label: "Lineup IQ" },
];

const MOVES: readonly HighlightSpec[] = [
  { id: "trade.best.est", label: "Best trade" },
  { id: "pickup.best", label: "Best waiver pickup" },
  { id: "draft.steal", label: "Best draft pick" },
];

const week = (r: Record<string, unknown>): WeekLine => ({
  week: Number(r.week),
  gameType: String(r.game_type),
  points: Number(r.points),
  opponentPoints: r.opp_points == null ? null : Number(r.opp_points),
  opponent: (r.opp_name as string | null) ?? null,
  result: (r.result as string | null) ?? null,
  left:
    r.optimal_points == null
      ? null
      : Math.round((Number(r.optimal_points) - Number(r.points)) * 100) / 100,
});

/**
 * "Wrapped" for one franchise and season: a story-sized summary of how the year went (record and finish, best and
 * worst weeks, luck and schedule, lineup decisions, the players who carried the team, and the moves it made). The
 * rankings reuse the season records, so the numbers match the Records pages.
 */
export async function franchiseWrapped(
  db: Db,
  leagueId: number,
  franchiseId: number,
  year: number
) {
  const ts = (
    await db.execute<{
      id: number;
      league_season_id: number;
      status: string;
      seed: number | null;
      final_place: number | null;
      made_playoffs: boolean | null;
      team_count: number;
    }>(sql`
      select ts.id, ts.league_season_id, ls.status::text as status, ts.seed, ts.final_place, ts.made_playoffs,
             ls.team_count
      from team_season ts
      join league_season ls on ls.id = ts.league_season_id and ls.enabled
      join franchise f on f.id = ts.franchise_id
      where ts.franchise_id = ${franchiseId} and f.league_id = ${leagueId} and ls.year = ${year}`)
  ).rows[0];
  if (!ts) throw new HttpError(404, `franchise ${franchiseId} has no ${year} season`);
  const tsId = Number(ts.id);

  const years = (
    await db.execute<{ year: number }>(sql`
      select ls.year from team_season t join league_season ls on ls.id = t.league_season_id and ls.enabled
      where t.franchise_id = ${franchiseId} order by ls.year`)
  ).rows.map((r) => Number(r.year));

  const games = (
    await db.execute<Record<string, unknown>>(sql`
      select tw.week, tw.game_type::text as game_type, tw.points::float8 as points, tw.result::text as result,
             tw.margin::float8 as margin, otw.points::float8 as opp_points, ots.name as opp_name,
             tw.optimal_points::float8 as optimal_points, tw.lineup_iq::float8 as iq, tw.week_rank,
             tw.is_perfect, tw.span_weeks
      from rec_team_week tw
      left join team_week otw on otw.team_season_id = tw.opponent_team_season_id and otw.week = tw.week
      left join team_season ots on ots.id = tw.opponent_team_season_id
      where tw.team_season_id = ${tsId}
      order by tw.week`)
  ).rows;
  const single = games.filter((g) => Number(g.span_weeks) === 1);
  const withOpp = single.filter((g) => g.opp_points != null);
  const best = (rows: Record<string, unknown>[], key: string, dir: 1 | -1) =>
    rows.length
      ? rows.reduce((a, b) => (dir * (Number(b[key]) - Number(a[key])) > 0 ? b : a))
      : undefined;

  const record = (
    await db.execute<{ w: number; l: number; t: number; pf: number; pa: number }>(sql`
      select count(*) filter (where result = 'W')::int as w, count(*) filter (where result = 'L')::int as l,
             count(*) filter (where result = 'T')::int as t,
             coalesce(sum(points_for) filter (where kind = 'h2h'), 0)::float8 as pf,
             coalesce(sum(points_against) filter (where kind = 'h2h'), 0)::float8 as pa
      from rec_game_result gr
      where gr.team_season_id = ${tsId} and (gr.kind = 'h2h' or gr.median_enabled)`)
  ).rows[0]!;

  const previous = (
    await db.execute<{ season: number; place: number | null; teams: number }>(sql`
      select season, final_place as place, team_count as teams from rec_team_season
      where franchise_id = ${franchiseId} and season = ${year - 1}`)
  ).rows[0];

  // Ranks among the league's teams that season.
  const seasonQuery = { seasons: String(year), limit: 200 };
  const ranks: WrappedRank[] = [];
  for (const r of RANKED) {
    const res = await runRecord(db, leagueId, r.id, seasonQuery);
    const row = res.rows.find((x) => x.refs.teamSeasonId === tsId);
    if (!row) continue;
    const col = res.meta.columns.find((c) => c.key === res.meta.sortKey);
    ranks.push({
      key: r.key,
      label: r.label,
      rank: row.rank,
      of: res.total,
      value: Number(row.values.value),
      valueType: col?.type ?? "decimal",
    });
  }

  const players = (
    await db.execute<Record<string, unknown>>(sql`
      select p.full_name as name, pw.position_mode as position, x.starter_points, x.starts, x.weeks
      from (
        select pw.player_id,
               coalesce(sum(pw.points) filter (where pw.slot_kind = 'starter'), 0)::float8 as starter_points,
               count(*) filter (where pw.slot_kind = 'starter')::int as starts, count(*)::int as weeks
        from rec_player_week pw where pw.team_season_id = ${tsId} and pw.points is not null
        group by pw.player_id
      ) x
      join player p on p.id = x.player_id
      join lateral (
        select mode() within group (order by position) as position_mode from rec_player_week
        where team_season_id = ${tsId} and player_id = x.player_id
      ) pw on true
      where x.starts > 0 order by x.starter_points desc, p.full_name limit 3`)
  ).rows;
  const bestGame = (
    await db.execute<Record<string, unknown>>(sql`
      select p.full_name as name, pw.position, pw.week, pw.points::float8 as points, pw.slot_kind::text as slot_kind
      from rec_player_week pw join player p on p.id = pw.player_id
      where pw.team_season_id = ${tsId} and pw.points is not null and pw.slot_kind in ('starter', 'bench')
      order by (pw.slot_kind = 'starter') desc, pw.points desc, pw.week limit 1`)
  ).rows[0];
  const benchRegret = (
    await db.execute<Record<string, unknown>>(sql`
      select p.full_name as name, pw.position, pw.week, pw.points::float8 as points
      from rec_player_week pw join player p on p.id = pw.player_id
      where pw.team_season_id = ${tsId} and pw.points is not null and pw.slot_kind = 'bench'
      order by pw.points desc, pw.week limit 1`)
  ).rows[0];

  const moves = (
    await db.execute<{ trades: number; claims: number; faab: number }>(sql`
      select
        (select count(distinct x.id) from "transaction" x join transaction_item i on i.transaction_id = x.id
          where x.type = 'trade' and x.status = 'complete'
            and (i.to_team_season_id = ${tsId} or i.from_team_season_id = ${tsId}))::int as trades,
        (select count(*) from "transaction" x
          where x.type = 'waiver' and x.status = 'complete' and x.creator_team_season_id = ${tsId})::int as claims,
        (select coalesce(sum(i.faab_bid), 0) from "transaction" x join transaction_item i on i.transaction_id = x.id
          where x.type = 'waiver' and x.status = 'complete' and i.to_team_season_id = ${tsId})::int as faab`)
  ).rows[0]!;
  const picks: Highlight[] = [];
  for (const spec of MOVES) {
    const res = await runSpec(db, leagueId, spec, {
      seasons: String(year),
      franchise: franchiseId,
      limit: 3,
    });
    picks.push(...topHighlights(res, spec, 1).slice(0, 1));
  }

  const opponents = (
    await db.execute<Record<string, unknown>>(sql`
      select gr.opponent_team_season_id as id,
             count(*) filter (where gr.result = 'W')::int as w, count(*) filter (where gr.result = 'L')::int as l,
             count(*) filter (where gr.result = 'T')::int as t,
             sum(gr.points_for)::float8 as pf, sum(gr.points_against)::float8 as pa
      from rec_game_result gr
      where gr.team_season_id = ${tsId} and gr.kind = 'h2h' and gr.opponent_team_season_id is not null
      group by gr.opponent_team_season_id order by sum(gr.points_for - gr.points_against) desc`)
  ).rows;

  const teams = await describeTeams(db, [tsId, ...opponents.map((o) => Number(o.id))]);
  const team = teams.get(tsId) as TeamRef;
  const lines = (rows: Record<string, unknown>[]) => rows.map(week);
  const hi = best(withOpp, "points", 1);
  const lo = best(withOpp, "points", -1);
  const wins = withOpp.filter((g) => g.result === "W");
  const losses = withOpp.filter((g) => g.result === "L");
  const iqs = single.filter((g) => g.iq != null);
  const lineupRows = single.filter((g) => g.optimal_points != null);
  const costliest = best(
    lineupRows.map((g) => ({ ...g, left: Number(g.optimal_points) - Number(g.points) })),
    "left",
    1
  );

  return {
    franchiseId,
    season: year,
    seasons: years,
    inProgress: ts.status !== "complete",
    team,
    summary: {
      wins: Number(record.w),
      losses: Number(record.l),
      ties: Number(record.t),
      pf: Number(record.pf),
      pa: Number(record.pa),
      seed: ts.seed == null ? null : Number(ts.seed),
      finalPlace: ts.final_place == null ? null : Number(ts.final_place),
      madePlayoffs: ts.made_playoffs,
      teams: Number(ts.team_count),
      previous: previous
        ? {
            season: Number(previous.season),
            place: previous.place == null ? null : Number(previous.place),
            teams: Number(previous.teams),
          }
        : null,
    },
    ranks,
    weeks: {
      games: single.length,
      average: single.length
        ? single.reduce((s, g) => s + Number(g.points), 0) / single.length
        : null,
      best: hi ? lines([hi])[0] : null,
      worst: lo ? lines([lo])[0] : null,
      biggestWin: wins.length ? lines([best(wins, "margin", 1)!])[0] : null,
      closestWin: wins.length ? lines([best(wins, "margin", -1)!])[0] : null,
      toughestLoss: losses.length ? lines([best(losses, "margin", -1)!])[0] : null,
      topScorerWeeks: single.filter((g) => Number(g.week_rank) === 1).length,
    },
    lineup: {
      averageIq: iqs.length ? iqs.reduce((s, g) => s + Number(g.iq), 0) / iqs.length : null,
      perfectWeeks: single.filter((g) => g.is_perfect === true).length,
      pointsLeft: lineupRows.length
        ? lineupRows.reduce((s, g) => s + (Number(g.optimal_points) - Number(g.points)), 0)
        : null,
      costliest: costliest ? lines([costliest])[0] : null,
    },
    players: {
      top: players.map((p) => ({
        name: String(p.name),
        position: (p.position as string | null) ?? null,
        points: Number(p.starter_points),
        starts: Number(p.starts),
      })),
      bestGame: bestGame
        ? {
            name: String(bestGame.name),
            position: (bestGame.position as string | null) ?? null,
            week: Number(bestGame.week),
            points: Number(bestGame.points),
          }
        : null,
      benchRegret: benchRegret
        ? {
            name: String(benchRegret.name),
            position: (benchRegret.position as string | null) ?? null,
            week: Number(benchRegret.week),
            points: Number(benchRegret.points),
          }
        : null,
    },
    moves: {
      trades: Number(moves.trades),
      claims: Number(moves.claims),
      faabSpent: Number(moves.faab),
      highlights: picks,
    },
    opponents: opponents
      .map((o) => ({
        team: teams.get(Number(o.id)),
        wins: Number(o.w),
        losses: Number(o.l),
        ties: Number(o.t),
        pointsFor: Number(o.pf),
        pointsAgainst: Number(o.pa),
      }))
      .filter((o) => o.team !== undefined),
  };
}
