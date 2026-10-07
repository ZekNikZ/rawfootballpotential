import { sql } from "@rfp/db";
import type { SQL } from "@rfp/db";
import {
  inList,
  scopeCond,
  seasonCond,
  weeksCond,
  type RankedRow,
  type RunContext,
} from "../context";
import { rankRows } from "../rank";

const strList = (values: readonly string[]): SQL =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  );

/** Filters on rec_player_week rows (alias `pw`) shared by the player engines. */
export function playerFilters(ctx: RunContext): SQL {
  const { q } = ctx;
  return sql`
    ${seasonCond(sql`pw.league_season_id`, ctx.seasonIds)}
    and pw.points is not null
    and ${scopeCond(sql`pw.game_type`, q.scope)}
    and ${weeksCond(sql`pw.week`, q.weeks)}
    and ${q.franchise ? sql`pw.franchise_id = ${q.franchise}` : sql`true`}
    and ${q.positions?.length ? sql`pw.position in (${strList(q.positions)})` : sql`true`}
    and ${q.slots?.length ? sql`pw.slot_kind::text in (${strList(q.slots)})` : sql`true`}
    and ${q.excludeZero ? sql`pw.points <> 0` : sql`true`}
    and ${q.countedOnly ? sql`pw.counts` : sql`true`}`;
}

/** Player-week records: highest / lowest single-week scores by a rostered player. */
export async function playerWeekRecord(ctx: RunContext): Promise<RankedRow[]> {
  const inner = sql`
    select
      round(pw.points::numeric, 3)::float8 as sort_value,
      pw.season, pw.franchise_id,
      jsonb_build_object('season', pw.season, 'week', pw.week, 'player', p.full_name, 'points', pw.points::float8,
                         'position', pw.position, 'slot', pw.slot) as data,
      jsonb_build_object('franchiseId', pw.franchise_id, 'teamSeasonId', pw.team_season_id, 'playerId', pw.player_id,
                         'leagueSeasonId', pw.league_season_id, 'season', pw.season, 'week', pw.week) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(pw.season, '-', lpad(pw.week::text, 2, '0'), '-', lpad(pw.team_season_id::text, 6, '0'), '-', lpad(pw.player_id::text, 7, '0')) as tie_key
    from rec_player_week pw
    join player p on p.id = pw.player_id
    join league_season ls on ls.id = pw.league_season_id
    where ${playerFilters(ctx)}`;
  return rankRows(ctx, inner);
}

/**
 * Player seasons: a player's total over the weeks he was rostered in the league, scored with that season's league
 * scoring (doc §2). By default one row per (player, team season) so a traded player shows for each team;
 * `combineTeams` sums across teams.
 */
export async function playerSeasonRecord(ctx: RunContext): Promise<RankedRow[]> {
  const combine = ctx.q.combineTeams;
  const groupBy = combine
    ? sql`pw.player_id, pw.league_season_id, pw.season`
    : sql`pw.player_id, pw.team_season_id, pw.franchise_id, pw.league_season_id, pw.season`;
  const teamCols = combine
    ? sql`(array_agg(pw.team_season_id order by pw.week))[1] as team_season_id, (array_agg(pw.franchise_id order by pw.week))[1] as franchise_id, array_agg(distinct pw.team_season_id) as team_season_ids`
    : sql`pw.team_season_id, pw.franchise_id, array[pw.team_season_id] as team_season_ids`;
  const inner = sql`
    with agg as (
      select pw.player_id, pw.league_season_id, pw.season, ${teamCols},
             sum(pw.points) as points, count(*) as weeks,
             avg(pw.points) as ppg,
             sum(pw.points) / nullif(count(*) filter (where pw.points <> 0), 0) as ppg_nonzero,
             max(pw.points) as best, min(pw.points) as worst,
             (array_agg(pw.week order by pw.points desc, pw.week))[1] as best_week,
             (array_agg(pw.week order by pw.points asc, pw.week))[1] as worst_week,
             mode() within group (order by pw.position) as position
      from rec_player_week pw
      where ${playerFilters(ctx)}
      group by ${groupBy}
    )
    select
      round(a.points::numeric, 3)::float8 as sort_value,
      a.season, a.franchise_id,
      jsonb_build_object('season', a.season, 'player', p.full_name, 'position', a.position, 'points', a.points::float8,
                         'weeks', a.weeks::int, 'ppg', a.ppg::float8, 'ppgNonZero', a.ppg_nonzero::float8,
                         'best', a.best::float8, 'bestWeek', a.best_week, 'worst', a.worst::float8, 'worstWeek', a.worst_week) as data,
      jsonb_build_object('franchiseId', a.franchise_id, 'teamSeasonId', a.team_season_id, 'teamSeasonIds', a.team_season_ids,
                         'playerId', a.player_id, 'leagueSeasonId', a.league_season_id, 'season', a.season) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(a.season, '-', lpad(a.team_season_id::text, 6, '0'), '-', lpad(a.player_id::text, 7, '0')) as tie_key
    from agg a
    join player p on p.id = a.player_id
    join league_season ls on ls.id = a.league_season_id`;
  return rankRows(ctx, inner);
}

void inList;
