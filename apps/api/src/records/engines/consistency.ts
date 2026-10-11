import { sql } from "@rfp/db";
import type { SQL } from "@rfp/db";
import { scopeCond, seasonCond, type RankedRow, type RunContext } from "../context";
import { rankRows } from "../rank";
import { minGames } from "./season-base";

// Schedule strength, score consistency, boom/bust weeks and career all-play: records built from the weekly scores
// of counted head-to-head games (regular season by default). Two-week games are left out, and so are median games.
// Season-grain records come out one row per team season; career-grain ones one row per franchise.

const franchiseRefs = sql`jsonb_build_object('franchiseId', franchise_id)`;
const franchiseTie = sql`lpad(franchise_id::text, 6, '0')`;
const r4 = (x: SQL) => sql`round((${x})::numeric, 4)::float8`;
const fmtRecord = (w: SQL, l: SQL, t: SQL) =>
  sql`(${w} || '-' || ${l} || case when ${t} > 0 then '-' || ${t} else '' end)`;

/** The counted single-week games of the selected seasons and scope, one row per team-week. */
function weekRows(ctx: RunContext): SQL {
  return sql`
    rw as (
      select tw.team_season_id, tw.league_season_id, tw.franchise_id, tw.season, tw.week, tw.points, tw.result,
             tw.opponent_team_season_id
      from rec_team_week tw
      where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)}
        and ${scopeCond(sql`tw.game_type`, ctx.q.scope)}
        and tw.span_weeks = 1
    )`;
}

/**
 * Strength of schedule: how good the opponents a team faced were, measured by their scoring. For each game the
 * opponent's average score over the rest of the season counts (the game against this team is left out, so a team is
 * not rated by its own result), and the schedule's strength is that average minus the league's average score that
 * season: +5 means the opponents scored 5 points a game more than a typical team. The opponents' win % (same
 * leave-one-out) is shown beside it. Career rows average over every game played.
 */
export async function strengthOfScheduleRecord(ctx: RunContext): Promise<RankedRow[]> {
  const career = ctx.def.grain === "franchise_career";
  const min = minGames(ctx);
  const gm = sql`
    ${weekRows(ctx)},
    tot as (
      select team_season_id, sum(points) as sp, count(*) as n,
             sum(case result when 'W' then 1.0 when 'T' then 0.5 else 0 end) as wins,
             count(*) filter (where result = 'W') as w, count(*) filter (where result = 'L') as l,
             count(*) filter (where result = 'T') as t
      from rw where opponent_team_season_id is not null group by team_season_id
    ),
    lg as (select league_season_id, avg(points) as ppg from rw group by league_season_id),
    gm as (
      select a.team_season_id, a.franchise_id, a.league_season_id, a.season,
             (ot.sp - o.points) / nullif(ot.n - 1, 0) as opp_ppg,
             (ot.wins - case o.result when 'W' then 1.0 when 'T' then 0.5 else 0 end) / nullif(ot.n - 1, 0) as opp_wp,
             lg.ppg as lg_ppg
      from rw a
      join rw o on o.team_season_id = a.opponent_team_season_id and o.week = a.week
      join tot ot on ot.team_season_id = o.team_season_id
      join tot own on own.team_season_id = a.team_season_id
      join lg on lg.league_season_id = a.league_season_id
      where own.n >= ${min}
    )`;
  if (career) {
    const inner = sql`
      with ${gm},
      c as (
        select gm.franchise_id, count(*) as games, avg(opp_ppg) as opp_ppg, avg(opp_wp) as opp_wp,
               avg(opp_ppg - lg_ppg) as sos, bool_or(ls.status <> 'complete') as in_progress
        from gm join league_season ls on ls.id = gm.league_season_id
        group by gm.franchise_id
      )
      select ${r4(sql`sos`)} as sort_value, 0 as season, franchise_id,
             jsonb_build_object('sos', ${r4(sql`sos`)}, 'oppAvg', ${r4(sql`opp_ppg`)},
                                'oppWinPct', ${r4(sql`opp_wp`)}, 'games', games::int) as data,
             ${franchiseRefs} as refs, in_progress, ${franchiseTie} as tie_key
      from c where sos is not null`;
    return rankRows(ctx, inner);
  }
  const inner = sql`
    with ${gm},
    t as (
      select gm.team_season_id, gm.franchise_id, gm.league_season_id, gm.season, count(*) as games,
             avg(opp_ppg) as opp_ppg, avg(opp_wp) as opp_wp, avg(lg_ppg) as lg_ppg, avg(opp_ppg - lg_ppg) as sos
      from gm
      where ${ctx.q.franchise ? sql`gm.franchise_id = ${ctx.q.franchise}` : sql`true`}
      group by gm.team_season_id, gm.franchise_id, gm.league_season_id, gm.season
    )
    select ${r4(sql`sos`)} as sort_value, t.season, t.franchise_id,
           jsonb_build_object('season', t.season, 'record', ${fmtRecord(sql`tot.w`, sql`tot.l`, sql`tot.t`)},
                              'sos', ${r4(sql`sos`)}, 'oppAvg', ${r4(sql`opp_ppg`)}, 'leagueAvg', ${r4(sql`lg_ppg`)},
                              'oppWinPct', ${r4(sql`opp_wp`)}, 'games', t.games::int) as data,
           jsonb_build_object('franchiseId', t.franchise_id, 'teamSeasonId', t.team_season_id,
                              'leagueSeasonId', t.league_season_id, 'season', t.season) as refs,
           (ls.status <> 'complete') as in_progress,
           concat(t.season, '-', lpad(t.team_season_id::text, 6, '0')) as tie_key
    from t
    join tot on tot.team_season_id = t.team_season_id
    join league_season ls on ls.id = t.league_season_id
    where t.games >= ${min} and sos is not null`;
  return rankRows(ctx, inner);
}

/**
 * Weekly score consistency: the sample standard deviation of a team's head-to-head scores. The coefficient of
 * variation (deviation / average) is shown so seasons with different scoring levels can be compared. A career row
 * pools each season's deviation around that season's own average (weighted by games), so a team that simply
 * scored more in a later, higher-scoring year is not counted as inconsistent.
 */
export async function scoreVolatilityRecord(ctx: RunContext): Promise<RankedRow[]> {
  const career = ctx.def.grain === "franchise_career";
  const min = minGames(ctx);
  const perSeason = sql`
    ${weekRows(ctx)},
    t as (
      select team_season_id, franchise_id, league_season_id, season, count(*) as n, avg(points) as m,
             stddev_samp(points) as sd, min(points) as lo, max(points) as hi
      from rw
      where ${ctx.q.franchise && !career ? sql`franchise_id = ${ctx.q.franchise}` : sql`true`}
      group by team_season_id, franchise_id, league_season_id, season
    )`;
  if (career) {
    const inner = sql`
      with ${perSeason},
      c as (
        select t.franchise_id, sum(n) as games, count(*) as seasons,
               sqrt(sum(sd * sd * (n - 1)) / nullif(sum(n - 1), 0)) as sd,
               sum(m * n) / nullif(sum(n), 0) as avg, min(lo) as lo, max(hi) as hi,
               bool_or(ls.status <> 'complete') as in_progress
        from t join league_season ls on ls.id = t.league_season_id
        where t.n >= 2 and t.sd is not null
        group by t.franchise_id
      )
      select ${r4(sql`sd`)} as sort_value, 0 as season, franchise_id,
             jsonb_build_object('stddev', ${r4(sql`sd`)}, 'avg', ${r4(sql`avg`)}, 'cv', ${r4(sql`sd / nullif(avg, 0)`)},
                                'high', hi::float8, 'low', lo::float8,
                                'games', games::int, 'seasons', seasons::int) as data,
             ${franchiseRefs} as refs, in_progress, ${franchiseTie} as tie_key
      from c where sd is not null`;
    return rankRows(ctx, inner);
  }
  const inner = sql`
    with ${perSeason}
    select ${r4(sql`sd`)} as sort_value, t.season, t.franchise_id,
           jsonb_build_object('season', t.season, 'stddev', ${r4(sql`sd`)}, 'avg', ${r4(sql`m`)},
                              'cv', ${r4(sql`sd / nullif(m, 0)`)}, 'high', hi::float8, 'low', lo::float8,
                              'games', t.n::int) as data,
           jsonb_build_object('franchiseId', t.franchise_id, 'teamSeasonId', t.team_season_id,
                              'leagueSeasonId', t.league_season_id, 'season', t.season) as refs,
           (ls.status <> 'complete') as in_progress,
           concat(t.season, '-', lpad(t.team_season_id::text, 6, '0')) as tie_key
    from t join league_season ls on ls.id = t.league_season_id
    where t.n >= ${min} and sd is not null`;
  return rankRows(ctx, inner);
}

/**
 * Boom and bust weeks: a week is a boom when the team scored at least one standard deviation above its own season
 * average, a bust when it scored at least one below it (the average and deviation come from that team season's
 * head-to-head scores in the selected scope). Team seasons with fewer than the minimum games, or no spread at all,
 * are left out. One engine, two records (the sort key picks boom or bust as the ranked count).
 */
export async function boomBustCountRecord(ctx: RunContext): Promise<RankedRow[]> {
  const min = minGames(ctx);
  const key = ctx.def.sortKey === "bust" ? sql`bust` : sql`boom`;
  const inner = sql`
    with ${weekRows(ctx)},
    base as (
      select rw.*, avg(points) over (partition by team_season_id) as m,
             stddev_samp(points) over (partition by team_season_id) as sd,
             count(*) over (partition by team_season_id) as n
      from rw
    ),
    c as (
      select b.franchise_id, count(*) as weeks,
             count(*) filter (where points >= m + sd) as boom,
             count(*) filter (where points <= m - sd) as bust,
             bool_or(ls.status <> 'complete') as in_progress
      from base b join league_season ls on ls.id = b.league_season_id
      where n >= ${min} and sd > 0
      group by b.franchise_id
    )
    select ${key}::float8 as sort_value, 0 as season, franchise_id,
           jsonb_build_object('boom', boom::int, 'bust', bust::int, 'weeks', weeks::int,
                              'boomPct', ${r4(sql`boom::numeric / nullif(weeks, 0)`)},
                              'bustPct', ${r4(sql`bust::numeric / nullif(weeks, 0)`)}) as data,
           ${franchiseRefs} as refs, in_progress, ${franchiseTie} as tie_key
    from c`;
  return rankRows(ctx, inner);
}

/**
 * Career all-play record and luck: every counted week's score against every other team's score that week,
 * summed over a franchise's seasons. Luck is actual wins minus the wins the all-play record predicts, season by
 * season (the all-play win % of a season times its games), added up. One engine, two records (all-play win % and luck).
 */
export async function careerAllPlayRecord(ctx: RunContext): Promise<RankedRow[]> {
  const sortKey = ctx.def.sortKey === "luck" ? sql`luck` : sql`ap_pct`;
  const inner = sql`
    with s as (
      select tw.team_season_id, tw.franchise_id, tw.league_season_id,
             count(*) as games,
             count(*) filter (where tw.result = 'W') as w, count(*) filter (where tw.result = 'L') as l,
             count(*) filter (where tw.result = 'T') as t,
             sum(tw.allplay_w) as aw, sum(tw.allplay_l) as al, sum(tw.allplay_t) as at
      from rec_team_week tw
      where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)}
        and ${scopeCond(sql`tw.game_type`, ctx.q.scope)}
        and tw.allplay_w is not null and tw.span_weeks = 1
      group by tw.team_season_id, tw.franchise_id, tw.league_season_id
    ),
    c as (
      select s.franchise_id, sum(games) as games, sum(w) as w, sum(l) as l, sum(t) as t,
             sum(aw) as aw, sum(al) as al, sum(at) as at,
             sum((w + 0.5 * t) - (aw + 0.5 * at)::numeric / nullif(aw + al + at, 0) * games) as luck,
             bool_or(ls.status <> 'complete') as in_progress
      from s join league_season ls on ls.id = s.league_season_id
      group by s.franchise_id
    ),
    x as (select c.*, (aw + 0.5 * at) / nullif(aw + al + at, 0) as ap_pct from c)
    select ${r4(sortKey)} as sort_value, 0 as season, franchise_id,
           jsonb_build_object('record', ${fmtRecord(sql`w`, sql`l`, sql`t`)},
                              'allPlay', ${fmtRecord(sql`aw`, sql`al`, sql`at`)},
                              'allPlayPct', ${r4(sql`ap_pct`)}, 'luck', ${r4(sql`luck`)}, 'games', games::int) as data,
           ${franchiseRefs} as refs, in_progress, ${franchiseTie} as tie_key
    from x where ap_pct is not null`;
  return rankRows(ctx, inner);
}
