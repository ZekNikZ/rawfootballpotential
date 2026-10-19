import { sql } from "@rfp/db";
import type { SQL } from "@rfp/db";
import { scopeCond, seasonCond, weeksCond, type RankedRow, type RunContext } from "../context";
import { rankRows } from "../rank";

// League-wide scoring: every team's points for a season or a week added together (and averaged per team-game).
// The three measures use the same definitions as the single-game records in team-week.ts.

interface Measure {
  /** The value summed per team-week, over alias `tw` (a rec_team_week row). */
  value: SQL;
  /** Team-weeks that have the value (the bench and teamwide ones need player data). */
  where: SQL;
}

// Everything every rostered player scored that week (not tw.points, which a commissioner override can change).
const teamwide = sql`(select sum(pw.points) from player_week pw where pw.team_week_id = tw.team_week_id)`;
const hasPlayers = sql`tw.optimal_points is not null`;

const MEASURES: Record<string, Measure> = {
  counted: { value: sql`tw.points`, where: sql`true` },
  bench: {
    value: sql`(coalesce(tw.bench_points, 0) + coalesce(tw.ir_points, 0))`,
    where: hasPlayers,
  },
  teamwide: { value: teamwide, where: hasPlayers },
};

/** `league.season.<measure>.<total|avg>` / `league.week.<measure>.<total|avg>` -> the measure. */
function measureOf(ctx: RunContext): Measure {
  const key = ctx.def.id.split(".")[2] ?? "";
  const measure = MEASURES[key];
  if (!measure) throw new Error(`no league scoring measure for ${ctx.def.id}`);
  return measure;
}

/**
 * One row per counted team-week with the measure's value. Two-week games (ESPN 2020 playoffs) are left out, like
 * the other single-game records, since their score covers two scoring periods.
 */
function teamWeeks(ctx: RunContext): SQL {
  const { q } = ctx;
  const m = measureOf(ctx);
  return sql`
    tw_values as (
      select tw.league_season_id, tw.season, tw.week, tw.team_season_id, (${m.value})::numeric as v
      from rec_team_week tw
      where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)}
        and ${scopeCond(sql`tw.game_type`, q.scope)}
        and ${weeksCond(sql`tw.week`, q.weeks)}
        and tw.span_weeks = 1
        and ${m.where}
    )`;
}

const isAvg = (ctx: RunContext) => ctx.def.sortKey === "avg";

/** One row per league season: points scored by every team that season, and per team-game. */
export async function leagueSeasonScoringRecord(ctx: RunContext): Promise<RankedRow[]> {
  const inner = sql`
    with ${teamWeeks(ctx)}
    select
      round((${isAvg(ctx) ? sql`avg(v)` : sql`sum(v)`})::numeric, 3)::float8 as sort_value,
      s.season,
      null::int as franchise_id,
      jsonb_build_object(
        'season', s.season, 'total', round(sum(v), 3)::float8, 'avg', round(avg(v), 3)::float8,
        'games', count(*)::int, 'teams', count(distinct team_season_id)::int, 'weeks', count(distinct week)::int
      ) as data,
      jsonb_build_object('leagueSeasonId', s.league_season_id, 'season', s.season) as refs,
      (ls.status <> 'complete') as in_progress,
      s.season::text as tie_key
    from tw_values s
    join league_season ls on ls.id = s.league_season_id
    group by s.league_season_id, s.season, ls.status`;
  return rankRows(ctx, inner);
}

/** One row per league week: points scored by every team that week, and per team-game. */
export async function leagueWeekScoringRecord(ctx: RunContext): Promise<RankedRow[]> {
  const inner = sql`
    with ${teamWeeks(ctx)}
    select
      round((${isAvg(ctx) ? sql`avg(v)` : sql`sum(v)`})::numeric, 3)::float8 as sort_value,
      s.season,
      null::int as franchise_id,
      jsonb_build_object(
        'season', s.season, 'week', s.week, 'total', round(sum(v), 3)::float8, 'avg', round(avg(v), 3)::float8,
        'games', count(*)::int
      ) as data,
      jsonb_build_object('leagueSeasonId', s.league_season_id, 'season', s.season, 'week', s.week) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(s.season, '-', lpad(s.week::text, 2, '0')) as tie_key
    from tw_values s
    join league_season ls on ls.id = s.league_season_id
    group by s.league_season_id, s.season, s.week, ls.status`;
  return rankRows(ctx, inner);
}
