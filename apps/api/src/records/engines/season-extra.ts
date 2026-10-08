import { sql } from "@rfp/db";
import type { SQL } from "@rfp/db";
import { scopeCond, seasonCond, weeksCond, type RankedRow, type RunContext } from "../context";
import { rankDirection, rankRows } from "../rank";
import { minGames, seasonStatsCte } from "./season-base";

const seasonRefs = sql`jsonb_build_object('franchiseId', franchise_id, 'teamSeasonId', team_season_id, 'leagueSeasonId', league_season_id, 'season', season)`;
const seasonTie = sql`concat(season, '-', lpad(team_season_id::text, 6, '0'))`;
const fmtRecord = (w: SQL, l: SQL, t: SQL) =>
  sql`(${w} || '-' || ${l} || case when ${t} > 0 then '-' || ${t} else '' end)`;

/**
 * All-play luck: actual wins against the wins a team's all-play record predicts (doc 4.5). The expected wins are
 * the all-play win % times the games played, so a team that would have gone 8-5 against everyone but went 11-2
 * was 3 wins lucky.
 */
export async function allPlayRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  const min = minGames(ctx);
  const sortKey = ctx.def.id === "season.allplay.high" ? sql`ap_pct` : sql`luck`;
  const inner = sql`
    with t as (
      select tw.team_season_id, tw.franchise_id, tw.league_season_id, tw.season,
             count(*) as games,
             count(*) filter (where tw.result = 'W') as w, count(*) filter (where tw.result = 'L') as l,
             count(*) filter (where tw.result = 'T') as t,
             sum(tw.allplay_w) as aw, sum(tw.allplay_l) as al, sum(tw.allplay_t) as at
      from rec_team_week tw
      where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)}
        and ${scopeCond(sql`tw.game_type`, q.scope)}
        and ${weeksCond(sql`tw.week`, q.weeks)}
        and ${q.franchise ? sql`tw.franchise_id = ${q.franchise}` : sql`true`}
        and tw.allplay_w is not null and tw.span_weeks = 1
      group by tw.team_season_id, tw.franchise_id, tw.league_season_id, tw.season
    ),
    x as (
      select t.*, (aw + 0.5 * at) / nullif(aw + al + at, 0) as ap_pct from t where games >= ${min}
    ),
    y as (
      select x.*, (w + 0.5 * t) - ap_pct * games as luck, ts.season_status
      from x join rec_team_season ts on ts.team_season_id = x.team_season_id
    )
    select
      round((${sortKey})::numeric, 4)::float8 as sort_value,
      season, franchise_id,
      jsonb_build_object(
        'season', season, 'record', ${fmtRecord(sql`w`, sql`l`, sql`t`)},
        'allPlay', ${fmtRecord(sql`aw`, sql`al`, sql`at`)}, 'allPlayPct', ap_pct::float8,
        'luck', luck::float8, 'expectedWins', (ap_pct * games)::float8, 'games', games
      ) as data,
      ${seasonRefs} as refs, (season_status <> 'complete') as in_progress, ${seasonTie} as tie_key
    from y where ap_pct is not null`;
  return rankRows(ctx, inner);
}

/**
 * Schedule swap: a team's regular-season scores played against every other team's schedule. Each other team's
 * opponent each week is faced in its place; weeks where that opponent was the team itself are skipped.
 */
export async function scheduleSwapRecord(ctx: RunContext): Promise<RankedRow[]> {
  // Each team is paired with its best schedule when ranking best-first, its worst when ranking worst-first.
  const best = rankDirection(ctx) === "desc";
  const order = best
    ? sql`pct desc, l asc, sched_team_season_id`
    : sql`pct asc, l desc, sched_team_season_id`;
  const inner = sql`
    with pairs as (
      select a.team_season_id as me, b.team_season_id as sched, a.franchise_id, a.league_season_id, a.season,
             case when a.points > o.points then 'W' when a.points < o.points then 'L' else 'T' end as r
      from rec_team_week a
      join rec_team_week b
        on b.league_season_id = a.league_season_id and b.week = a.week and b.team_season_id <> a.team_season_id
      join team_week o on o.team_season_id = b.opponent_team_season_id and o.week = b.week
      where ${seasonCond(sql`a.league_season_id`, ctx.seasonIds)}
        and a.game_type = 'regular' and b.game_type = 'regular'
        and ${ctx.q.franchise ? sql`a.franchise_id = ${ctx.q.franchise}` : sql`true`}
        and b.opponent_team_season_id <> a.team_season_id
    ),
    agg as (
      select me, sched as sched_team_season_id, franchise_id, league_season_id, season,
             count(*) filter (where r = 'W') as w, count(*) filter (where r = 'L') as l,
             count(*) filter (where r = 'T') as t
      from pairs group by me, sched, franchise_id, league_season_id, season
    ),
    scored as (
      select agg.*, (w + 0.5 * t) / nullif(w + l + t, 0) as pct from agg
    ),
    pick as (
      select distinct on (me) * from scored where pct is not null order by me, ${order}
    ),
    actual as (
      select tw.team_season_id,
             count(*) filter (where tw.result = 'W') as w, count(*) filter (where tw.result = 'L') as l,
             count(*) filter (where tw.result = 'T') as t
      from rec_team_week tw
      where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)} and tw.game_type = 'regular'
      group by tw.team_season_id
    )
    select
      round(pick.pct::numeric, 4)::float8 as sort_value,
      pick.season, pick.franchise_id,
      jsonb_build_object(
        'season', pick.season, 'record', ${fmtRecord(sql`pick.w`, sql`pick.l`, sql`pick.t`)}, 'winPct', pick.pct::float8,
        'actual', ${fmtRecord(sql`actual.w`, sql`actual.l`, sql`actual.t`)}
      ) as data,
      jsonb_build_object(
        'franchiseId', pick.franchise_id, 'teamSeasonId', pick.me, 'leagueSeasonId', pick.league_season_id,
        'season', pick.season, 'opponentTeamSeasonId', pick.sched_team_season_id
      ) as refs,
      (ts.season_status <> 'complete') as in_progress,
      concat(pick.season, '-', lpad(pick.me::text, 6, '0')) as tie_key
    from pick
    join actual on actual.team_season_id = pick.me
    join rec_team_season ts on ts.team_season_id = pick.me`;
  return rankRows(ctx, inner);
}

/** Weeks as the league's top (or lowest) scorer in a season. */
export async function weeklyCountsRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  const top = ctx.def.id === "season.top-scorer";
  const inner = sql`
    with w as (
      select tw.*, max(tw.points) over (partition by tw.league_season_id, tw.week) as hi,
             min(tw.points) over (partition by tw.league_season_id, tw.week) as lo
      from rec_team_week tw
      where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)} and tw.span_weeks = 1
    ),
    t as (
      select tw.team_season_id, tw.franchise_id, tw.league_season_id, tw.season,
             count(*) filter (where tw.points = ${top ? sql`tw.hi` : sql`tw.lo`}) as cnt, count(*) as weeks,
             count(*) filter (where tw.result = 'W') as w, count(*) filter (where tw.result = 'L') as l,
             count(*) filter (where tw.result = 'T') as t
      from w tw
      where ${scopeCond(sql`tw.game_type`, q.scope)}
        and ${q.franchise ? sql`tw.franchise_id = ${q.franchise}` : sql`true`}
      group by tw.team_season_id, tw.franchise_id, tw.league_season_id, tw.season
    )
    select
      t.cnt::float8 as sort_value,
      t.season, t.franchise_id,
      jsonb_build_object('season', t.season, 'count', t.cnt::int, 'weeks', t.weeks::int,
                         'record', ${fmtRecord(sql`t.w`, sql`t.l`, sql`t.t`)}) as data,
      jsonb_build_object('franchiseId', t.franchise_id, 'teamSeasonId', t.team_season_id,
                         'leagueSeasonId', t.league_season_id, 'season', t.season) as refs,
      (ts.season_status <> 'complete') as in_progress,
      concat(t.season, '-', lpad(t.team_season_id::text, 6, '0')) as tie_key
    from t join rec_team_season ts on ts.team_season_id = t.team_season_id`;
  return rankRows(ctx, inner);
}

/** Seeds, finishes, and the best and worst champions (regular-season scope, set by the record). */
export async function seedFinishRecord(ctx: RunContext): Promise<RankedRow[]> {
  const id = ctx.def.id;
  const spec: Record<string, { value: SQL; where: SQL }> = {
    "seed.lowest-champion": { value: sql`seed`, where: sql`final_place = 1 and seed is not null` },
    "seed.top-worst": { value: sql`final_place`, where: sql`seed = 1 and final_place is not null` },
    "seed.worst-record-playoffs": {
      value: sql`win_pct`,
      where: sql`made_playoffs is true and w + l + t > 0`,
    },
    "seed.best-record-missed": {
      value: sql`win_pct`,
      where: sql`made_playoffs is false and final_place is not null and w + l + t > 0`,
    },
    "champ.worst": { value: sql`pf`, where: sql`final_place = 1` },
    "champ.best-non": { value: sql`pf`, where: sql`final_place > 1` },
  };
  const s = spec[id];
  if (!s) throw new Error(`no seed/finish spec for ${id}`);
  const inner = sql`
    with ${seasonStatsCte(ctx)},
    ap as (
      select tw.team_season_id, sum(tw.allplay_w + 0.5 * tw.allplay_t) / nullif(sum(tw.allplay_w + tw.allplay_l + tw.allplay_t), 0) as ap_pct
      from rec_team_week tw
      where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)} and tw.game_type = 'regular' and tw.allplay_w is not null
      group by tw.team_season_id
    ),
    x as (
      select ss.*, rts.seed, ap.ap_pct, (ss.w + 0.5 * ss.t) / nullif(ss.w + ss.l + ss.t, 0) as win_pct
      from ss
      join rec_team_season rts on rts.team_season_id = ss.team_season_id
      left join ap on ap.team_season_id = ss.team_season_id
      where ss.games > 0
    )
    select
      round((${s.value})::numeric, 4)::float8 as sort_value,
      season, franchise_id,
      jsonb_build_object(
        'season', season, 'seed', seed, 'finalPlace', final_place, 'pf', pf::float8, 'winPct', win_pct::float8,
        'record', ${fmtRecord(sql`w`, sql`l`, sql`t`)}, 'allPlayPct', ap_pct::float8
      ) as data,
      ${seasonRefs} as refs, (season_status <> 'complete') as in_progress, ${seasonTie} as tie_key
    from x where ${s.where}`;
  return rankRows(ctx, inner);
}

/** Season trajectory from the standings after each week (team_season_week). */
export async function trajectoryRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  const first = ctx.def.id === "trajectory.weeks-first";
  // "Biggest fall": first place after the last regular-season week, or after any week the weeks filter allows.
  const fallWeeks = q.weeks
    ? sql`tsw.week between ${q.weeks.from} and ${q.weeks.to}`
    : sql`tsw.week = ls.regular_season_weeks`;
  const inner = sql`
    with t as (
      select ts.team_season_id, ts.franchise_id, ts.league_season_id, ts.season, ts.final_place, ts.season_status,
             count(*) filter (where tsw.rank = 1 and tsw.week <= ls.regular_season_weeks) as weeks_first,
             count(*) filter (where tsw.rank = 1 and ${fallWeeks}) as first_in_range,
             (array_agg(tsw.wins order by tsw.week desc) filter (where tsw.week <= ls.regular_season_weeks))[1] as w,
             (array_agg(tsw.losses order by tsw.week desc) filter (where tsw.week <= ls.regular_season_weeks))[1] as l,
             (array_agg(tsw.ties order by tsw.week desc) filter (where tsw.week <= ls.regular_season_weeks))[1] as t
      from rec_team_season ts
      join league_season ls on ls.id = ts.league_season_id
      join team_season_week tsw on tsw.team_season_id = ts.team_season_id
      where ${seasonCond(sql`ts.league_season_id`, ctx.seasonIds)}
        and ts.final_place is not null
        and ${q.franchise ? sql`ts.franchise_id = ${q.franchise}` : sql`true`}
      group by ts.team_season_id, ts.franchise_id, ts.league_season_id, ts.season, ts.final_place, ts.season_status
    )
    select
      ${first ? sql`weeks_first` : sql`final_place`}::float8 as sort_value,
      season, franchise_id,
      jsonb_build_object('season', season, 'finalPlace', final_place, 'weeksFirst', weeks_first::int,
                         'record', ${fmtRecord(sql`w`, sql`l`, sql`t`)}) as data,
      ${seasonRefs} as refs, (season_status <> 'complete') as in_progress, ${seasonTie} as tie_key
    from t
    where ${first ? sql`final_place > 1 and weeks_first > 0` : sql`final_place > 1 and first_in_range > 0`}`;
  return rankRows(ctx, inner);
}

/** Starter points a team got from the players it drafted that season, while it had them. */
export async function draftClassRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  const inner = sql`
    with picks as (
      select dp.team_season_id, dp.franchise_id, dp.league_season_id, dp.season, dp.player_id
      from rec_draft_pick dp
      where dp.player_id is not null and ${seasonCond(sql`dp.league_season_id`, ctx.seasonIds)}
        and ${q.franchise ? sql`dp.franchise_id = ${q.franchise}` : sql`true`}
    ),
    scored as (
      select p.*, pl.full_name, coalesce(sp.pts, 0) as pts, coalesce(sp.starts, 0) as starts
      from picks p
      join player pl on pl.id = p.player_id
      left join lateral (
        select sum(pw.points) as pts, count(*) as starts
        from rec_player_week pw
        where pw.team_season_id = p.team_season_id and pw.player_id = p.player_id
          and pw.slot_kind = 'starter' and pw.counts and pw.points is not null
          and ${scopeCond(sql`pw.game_type`, q.scope)}
      ) sp on true
    ),
    cls as (
      select team_season_id, franchise_id, league_season_id, season, count(*) as picks,
             sum(pts) as class_points, count(*) filter (where starts > 0) as starters,
             (array_agg(full_name order by pts desc, full_name))[1] as best_pick
      from scored group by team_season_id, franchise_id, league_season_id, season
    )
    select
      round(cls.class_points::numeric, 3)::float8 as sort_value,
      cls.season, cls.franchise_id,
      jsonb_build_object('season', cls.season, 'classPoints', cls.class_points::float8, 'picks', cls.picks::int,
                         'starters', cls.starters::int, 'bestPick', cls.best_pick) as data,
      jsonb_build_object('franchiseId', cls.franchise_id, 'teamSeasonId', cls.team_season_id,
                         'leagueSeasonId', cls.league_season_id, 'season', cls.season) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(cls.season, '-', lpad(cls.team_season_id::text, 6, '0')) as tie_key
    from cls join league_season ls on ls.id = cls.league_season_id`;
  return rankRows(ctx, inner);
}
