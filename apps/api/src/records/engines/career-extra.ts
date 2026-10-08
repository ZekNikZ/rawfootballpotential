import { sql } from "@rfp/db";
import type { SQL } from "@rfp/db";
import { scopeCond, seasonCond, type RankedRow, type RunContext } from "../context";
import { rankRows } from "../rank";
import { minGames } from "./season-base";
import { teamWeekBase } from "./team-week-extra";

const franchiseRefs = sql`jsonb_build_object('franchiseId', franchise_id)`;
const tieKey = sql`lpad(franchise_id::text, 6, '0')`;

/** Counts of should've-won losses, coulda-been-a-contender eliminations and bye-week blunders per franchise. */
export async function careerRegretRecord(ctx: RunContext): Promise<RankedRow[]> {
  const cond: Record<string, { hit: SQL; base: SQL }> = {
    "career.shouldve-won": {
      hit: sql`tw.result = 'L' and tw.optimal_points > tw.opp_points`,
      base: sql`tw.result = 'L'`,
    },
    "career.contender": {
      hit: sql`tw.first_playoff_loss and tw.optimal_points > tw.opp_points`,
      base: sql`tw.first_playoff_loss`,
    },
    "career.blunders": {
      hit: sql`tw.result = 'L' and coalesce(tw.asleep_points_lost, 0) > 0
               and tw.points + tw.asleep_points_lost > tw.opp_points`,
      base: sql`tw.result = 'L'`,
    },
  };
  const spec = cond[ctx.def.id];
  if (!spec) throw new Error(`no career regret spec for ${ctx.def.id}`);
  const inner = sql`
    with ${teamWeekBase(ctx)},
    c as (
      select tw.franchise_id,
             count(*) filter (where ${spec.hit}) as cnt,
             count(*) filter (where ${spec.base}) as losses,
             bool_or(ls.status <> 'complete') as in_progress
      from w tw join league_season ls on ls.id = tw.league_season_id
      where ${scopeCond(sql`tw.game_type`, ctx.q.scope)}
        and tw.optimal_points is not null
      group by tw.franchise_id
    )
    select cnt::float8 as sort_value, 0 as season, franchise_id,
           jsonb_build_object('count', cnt::int, 'losses', losses::int,
                              'pct', (cnt::numeric / nullif(losses, 0))::float8) as data,
           ${franchiseRefs} as refs, in_progress, ${tieKey} as tie_key
    from c`;
  return rankRows(ctx, inner);
}

/** Record in games decided by fewer than 5 points (close) or more than 50 (blowouts). */
export async function careerMarginsRecord(ctx: RunContext): Promise<RankedRow[]> {
  const close = ctx.def.id.startsWith("career.close");
  const inner = sql`
    with c as (
      select tw.franchise_id,
             count(*) filter (where tw.result = 'W') as wins, count(*) filter (where tw.result = 'L') as losses,
             count(*) as games, bool_or(ls.status <> 'complete') as in_progress
      from rec_team_week tw join league_season ls on ls.id = tw.league_season_id
      where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)}
        and ${scopeCond(sql`tw.game_type`, ctx.q.scope)}
        and tw.result in ('W', 'L') and tw.span_weeks = 1
        and ${close ? sql`abs(tw.margin) < 5` : sql`abs(tw.margin) > 50`}
      group by tw.franchise_id
    )
    select ${ctx.def.sortKey === "wins" ? sql`wins` : sql`losses`}::float8 as sort_value, 0 as season, franchise_id,
           jsonb_build_object('wins', wins::int, 'losses', losses::int, 'games', games::int,
                              'winPct', (wins::numeric / nullif(games, 0))::float8) as data,
           ${franchiseRefs} as refs, in_progress, ${tieKey} as tie_key
    from c`;
  return rankRows(ctx, inner);
}

/**
 * Point differential per head-to-head game (points for minus points against; positive = outscored the opponent): the
 * average, the worst (most negative) and best (most positive) single game, and the sample standard deviation. Two-week
 * games and median games are not single matchups and are left out. One engine, four records (the sort key picks one).
 */
export async function careerDifferentialRecord(ctx: RunContext): Promise<RankedRow[]> {
  const key = ctx.def.sortKey as "avg" | "min" | "max" | "stddev";
  const r4 = (x: SQL) => sql`round((${x})::numeric, 4)::float8`;
  const inner = sql`
    with c as (
      select tw.franchise_id, count(*) as games,
             avg(tw.margin) as avg, min(tw.margin) as min, max(tw.margin) as max, stddev_samp(tw.margin) as stddev,
             bool_or(ls.status <> 'complete') as in_progress
      from rec_team_week tw join league_season ls on ls.id = tw.league_season_id
      where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)}
        and ${scopeCond(sql`tw.game_type`, ctx.q.scope)}
        and tw.margin is not null and tw.span_weeks = 1
      group by tw.franchise_id
    )
    select ${r4(sql.raw(key))} as sort_value, 0 as season, franchise_id,
           jsonb_build_object('avg', ${r4(sql`avg`)}, 'min', ${r4(sql`min`)}, 'max', ${r4(sql`max`)},
                              'stddev', ${r4(sql`stddev`)}, 'games', games::int) as data,
           ${franchiseRefs} as refs, in_progress, ${tieKey} as tie_key
    from c`;
  return rankRows(ctx, inner);
}

/** Weeks as top or lowest scorer, and starters on a bye or inactive, over a career. */
export async function careerWeeklyRecord(ctx: RunContext): Promise<RankedRow[]> {
  const id = ctx.def.id;
  const asleep = id === "career.asleep";
  const top = id === "career.top-scorer";
  const inner = sql`
    with w as (
      select tw.*, max(tw.points) over (partition by tw.league_season_id, tw.week) as hi,
             min(tw.points) over (partition by tw.league_season_id, tw.week) as lo,
             s.asleep_starters as dead, s.bye_starters as bye, s.asleep_points_lost as lost
      from rec_team_week tw
      left join team_week_stats s on s.team_week_id = tw.team_week_id
      where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)} and tw.span_weeks = 1
    ),
    c as (
      select tw.franchise_id,
             ${
               asleep
                 ? sql`coalesce(sum(tw.dead), 0)`
                 : top
                   ? sql`count(*) filter (where tw.points = tw.hi)`
                   : sql`count(*) filter (where tw.points = tw.lo)`
             } as cnt,
             coalesce(sum(tw.bye), 0) as bye, coalesce(sum(tw.lost), 0) as lost,
             ${asleep ? sql`count(*) filter (where tw.dead is not null)` : sql`count(*)`} as weeks,
             bool_or(ls.status <> 'complete') as in_progress
      from w tw join league_season ls on ls.id = tw.league_season_id
      where ${scopeCond(sql`tw.game_type`, ctx.q.scope)}
      group by tw.franchise_id
    )
    select cnt::float8 as sort_value, 0 as season, franchise_id,
           jsonb_build_object('count', cnt::int, 'weeks', weeks::int, 'pct', (cnt::numeric / nullif(weeks, 0))::float8,
                              'byeStarters', bye::int, 'pointsLost', lost::float8) as data,
           ${franchiseRefs} as refs, in_progress, ${tieKey} as tie_key
    from c where weeks > 0`;
  return rankRows(ctx, inner);
}

/** Longest run of consecutive seasons with a title drought, playoff trips or toilet bowls. */
export async function careerRunsRecord(ctx: RunContext): Promise<RankedRow[]> {
  const flag: Record<string, SQL> = {
    "drought.title": sql`coalesce(ts.final_place, 0) <> 1`,
    "streak.playoffs": sql`ts.made_playoffs is true`,
    "streak.toilet-bowl": sql`exists (
      select 1 from rec_game_result gr
      where gr.team_season_id = ts.team_season_id and gr.game_type = 'toilet_bowl')`,
  };
  const f = flag[ctx.def.id];
  if (!f) throw new Error(`no run spec for ${ctx.def.id}`);
  const inner = sql`
    with t as (
      select ts.franchise_id, ts.season, (${f}) as hit
      from rec_team_season ts
      where ${seasonCond(sql`ts.league_season_id`, ctx.seasonIds)} and ts.season_complete
    ),
    runs as (
      select franchise_id, count(*) as len, min(season) as from_season, max(season) as to_season
      from (
        select t.*, row_number() over (partition by franchise_id order by season)
                    - row_number() over (partition by franchise_id, hit order by season) as grp
        from t
      ) x
      where hit
      group by franchise_id, grp
    ),
    best as (
      select distinct on (franchise_id) * from runs order by franchise_id, len desc, from_season
    ),
    totals as (select franchise_id, count(*) as total from t group by franchise_id)
    select coalesce(b.len, 0)::float8 as sort_value, 0 as season, tt.franchise_id,
           jsonb_build_object('run', coalesce(b.len, 0)::int, 'total', tt.total::int,
                              'span', case when b.len is null then null
                                           when b.from_season = b.to_season then b.from_season::text
                                           else b.from_season || ' - ' || b.to_season end) as data,
           jsonb_build_object('franchiseId', tt.franchise_id) as refs, false as in_progress,
           lpad(tt.franchise_id::text, 6, '0') as tie_key
    from totals tt left join best b on b.franchise_id = tt.franchise_id`;
  return rankRows(ctx, inner);
}

/** Head-to-head series between two franchises: most played, most lopsided and longest win streaks. */
export async function rivalryRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  if (ctx.def.id === "rivalry.streak") {
    const inner = sql`
      with g as (
        select tw.franchise_id as a, ots.franchise_id as b, tw.season, tw.week, tw.result,
               (ls.status <> 'complete') as prog,
               row_number() over (partition by tw.franchise_id, ots.franchise_id order by tw.season, tw.week) as rn
        from rec_team_week tw
        join team_season ots on ots.id = tw.opponent_team_season_id
        join league_season ls on ls.id = tw.league_season_id
        where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)}
          and ${scopeCond(sql`tw.game_type`, q.scope)}
          and tw.result in ('W', 'L', 'T') and ots.franchise_id <> tw.franchise_id
      ),
      runs as (
        select a, b, count(*) as len, bool_or(prog) as prog,
               (array_agg(season || ' WK ' || week order by rn))[1] as from_when,
               (array_agg(season || ' WK ' || week order by rn desc))[1] as to_when
        from (select g.*, rn - row_number() over (partition by a, b, result order by rn) as grp from g) x
        where result = 'W'
        group by a, b, grp
      ),
      best as (select distinct on (a, b) * from runs order by a, b, len desc, from_when)
      select len::float8 as sort_value, 0 as season, a as franchise_id,
             jsonb_build_object('streak', len::int, 'span', from_when || ' - ' || to_when) as data,
             jsonb_build_object('franchiseId', a, 'opponentFranchiseId', b) as refs, prog as in_progress,
             lpad(a::text, 6, '0') || '-' || lpad(b::text, 6, '0') as tie_key
      from best`;
    return rankRows(ctx, inner);
  }
  const lopsided = ctx.def.id === "rivalry.lopsided";
  const min = lopsided ? minGames(ctx) : 1;
  const inner = sql`
    with s as (
      select tw.franchise_id as a, ots.franchise_id as b,
             count(*) as games,
             count(*) filter (where tw.result = 'W') as a_wins, count(*) filter (where tw.result = 'L') as b_wins,
             count(*) filter (where tw.result = 'T') as ties, bool_or(ls.status <> 'complete') as prog
      from rec_team_week tw
      join team_season ots on ots.id = tw.opponent_team_season_id
      join league_season ls on ls.id = tw.league_season_id
      where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)}
        and ${scopeCond(sql`tw.game_type`, q.scope)}
        and tw.franchise_id < ots.franchise_id
      group by tw.franchise_id, ots.franchise_id
    ),
    lead as (
      select case when a_wins >= b_wins then a else b end as team,
             case when a_wins >= b_wins then b else a end as opp,
             games, greatest(a_wins, b_wins) as w, least(a_wins, b_wins) as l, ties, prog
      from s where games >= ${min}
    )
    select ${lopsided ? sql`round(((w + 0.5 * ties)::numeric / games), 4)` : sql`games`}::float8 as sort_value,
           0 as season, team as franchise_id,
           jsonb_build_object('games', games::int, 'record', w || '-' || l || case when ties > 0 then '-' || ties else '' end,
                              'winPct', ((w + 0.5 * ties)::numeric / games)::float8) as data,
           jsonb_build_object('franchiseId', team, 'opponentFranchiseId', opp) as refs, prog as in_progress,
           lpad(team::text, 6, '0') || '-' || lpad(opp::text, 6, '0') as tie_key
    from lead`;
  return rankRows(ctx, inner);
}
