import { sql } from "@rfp/db";
import type { SQL } from "@rfp/db";
import { scopeCond, seasonCond, weeksCond, type RankedRow, type RunContext } from "../context";
import { rankRows } from "../rank";

interface Spec {
  /** The ranked value, over alias `tw` (a rec_team_week row). */
  value: SQL;
  where?: SQL;
}

// Everything every rostered player scored that week (not tw.points, which a commissioner override can change).
const teamwide = sql`(select sum(pw.points) from player_week pw where pw.team_week_id = tw.team_week_id)`;
const bench = sql`(coalesce(tw.bench_points, 0) + coalesce(tw.ir_points, 0))`;
const hasPlayers = sql`tw.optimal_points is not null`;

const SPECS: Record<string, Spec> = {
  "score.high": { value: sql`tw.points` },
  // Winner-side records: ties (result T) are not wins, so they never appear (doc §1.4 bug 2).
  blowout: { value: sql`tw.margin`, where: sql`tw.result = 'W'` },
  "loss.high-score": { value: sql`tw.points`, where: sql`tw.result = 'L'` },
  "win.low-score": { value: sql`tw.points`, where: sql`tw.result = 'W'` },
  "teamwide.high": { value: teamwide, where: hasPlayers },
  "bench.high": { value: bench, where: hasPlayers },
  "potential.high": { value: sql`tw.optimal_points`, where: hasPlayers },
  "actual.high": { value: sql`tw.points`, where: hasPlayers },
  "ratio.high": { value: sql`tw.lineup_iq`, where: hasPlayers },
};

/** Team-week records: one candidate row per counted team in a completed week. */
export async function teamWeekRecord(ctx: RunContext): Promise<RankedRow[]> {
  const spec = SPECS[ctx.def.id];
  if (!spec) throw new Error(`no team-week spec for ${ctx.def.id}`);
  const { q } = ctx;
  const inner = sql`
    select
      round((${spec.value})::numeric, 3)::float8 as sort_value,
      tw.season,
      tw.franchise_id,
      jsonb_build_object(
        'season', tw.season, 'week', tw.week,
        'points', tw.points::float8, 'opponentPoints', otw.points::float8, 'margin', tw.margin::float8,
        'teamwide', ${teamwide}::float8, 'bench', ${bench}::float8,
        'potential', tw.optimal_points::float8, 'ratio', tw.lineup_iq::float8
      ) as data,
      jsonb_build_object(
        'franchiseId', tw.franchise_id, 'teamSeasonId', tw.team_season_id,
        'opponentTeamSeasonId', tw.opponent_team_season_id, 'opponentFranchiseId', ots.franchise_id,
        'matchupId', tw.matchup_id, 'leagueSeasonId', tw.league_season_id, 'season', tw.season, 'week', tw.week
      ) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(tw.season, '-', lpad(tw.week::text, 2, '0'), '-', lpad(tw.team_season_id::text, 6, '0')) as tie_key
    from rec_team_week tw
    join league_season ls on ls.id = tw.league_season_id
    left join team_week otw on otw.team_season_id = tw.opponent_team_season_id and otw.week = tw.week
    left join team_season ots on ots.id = tw.opponent_team_season_id
    where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)}
      and ${scopeCond(sql`tw.game_type`, q.scope)}
      and ${weeksCond(sql`tw.week`, q.weeks)}
      and tw.span_weeks = 1
      and ${q.franchise ? sql`tw.franchise_id = ${q.franchise}` : sql`true`}
      and ${q.opponent ? sql`ots.franchise_id = ${q.opponent}` : sql`true`}
      and ${spec.where ?? sql`true`}`;
  return rankRows(ctx, inner);
}

/** Best scores that did not count: bye weeks, eliminated teams and games outside any bracket (doc §2). */
export async function uncountedRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  const inner = sql`
    select
      tw.points::float8 as sort_value,
      tw.season,
      tw.franchise_id,
      jsonb_build_object(
        'season', tw.season, 'week', tw.week, 'points', tw.points::float8,
        'topPlayer', top.name || ' (' || coalesce(top.points::float8::text, '0') || ')',
        'why', case when tw.matchup_id is null then 'No game' else 'Game outside the brackets' end
      ) as data,
      jsonb_build_object(
        'franchiseId', tw.franchise_id, 'teamSeasonId', tw.team_season_id, 'leagueSeasonId', tw.league_season_id,
        'season', tw.season, 'week', tw.week
      ) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(tw.season, '-', lpad(tw.week::text, 2, '0'), '-', lpad(tw.team_season_id::text, 6, '0')) as tie_key
    from rec_team_week_all tw
    join league_season ls on ls.id = tw.league_season_id
    left join lateral (
      select p.full_name as name, pw.points
      from player_week pw join player p on p.id = pw.player_id
      where pw.team_week_id = tw.team_week_id and pw.points is not null
      order by pw.points desc, p.full_name limit 1
    ) top on true
    where not tw.counts and tw.span_weeks = 1
      and ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)}
      and ${q.franchise ? sql`tw.franchise_id = ${q.franchise}` : sql`true`}`;
  return rankRows(ctx, inner);
}
