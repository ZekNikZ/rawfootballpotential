import { sql } from "@rfp/db";
import type { SQL } from "@rfp/db";
import {
  medianCond,
  scopeCond,
  seasonCond,
  weeksCond,
  type RankedRow,
  type RunContext,
} from "../context";
import { rankRows } from "../rank";
import { minGames, seasonStatsCte } from "./season-base";

const franchiseRefs = sql`jsonb_build_object('franchiseId', franchise_id)`;
const tieKey = sql`lpad(franchise_id::text, 6, '0')`;

/** Longest win / loss runs per franchise, per season (a tie ends both: doc §2), with every season that holds the max. */
function streaksCte(ctx: RunContext): SQL {
  const { q } = ctx;
  return sql`
    streak_rows as (
      select gr.franchise_id, gr.league_season_id, gr.season, gr.result,
             row_number() over (partition by gr.franchise_id, gr.league_season_id order by gr.week, gr.seq) as rn
      from rec_game_result gr
      where ${seasonCond(sql`gr.league_season_id`, ctx.seasonIds)}
        and ${scopeCond(sql`gr.game_type`, q.scope)}
        and ${weeksCond(sql`gr.week`, q.weeks)}
        and ${medianCond(sql`gr.kind`, sql`gr.median_enabled`, q.median)}
    ),
    runs as (
      select franchise_id, league_season_id, season, result, count(*) as len
      from (
        select x.*, x.rn - row_number() over (partition by franchise_id, league_season_id, result order by rn) as grp
        from streak_rows x where result in ('W', 'L')
      ) y
      group by franchise_id, league_season_id, season, result, grp
    ),
    runmax as (select franchise_id, result, max(len) as mx from runs group by franchise_id, result),
    streaks as (
      select r.franchise_id, r.result, m.mx, array_agg(distinct r.season order by r.season) as seasons
      from runs r join runmax m on m.franchise_id = r.franchise_id and m.result = r.result and r.len = m.mx
      group by r.franchise_id, r.result, m.mx
    )`;
}

export async function careerStandingsRecord(ctx: RunContext): Promise<RankedRow[]> {
  const values: Record<string, SQL> = {
    wins: sql`wins`,
    losses: sql`losses`,
    years: sql`years`,
    winPct: sql`win_pct`,
    winStreak: sql`coalesce(win_streak, 0)`,
    lossStreak: sql`coalesce(loss_streak, 0)`,
  };
  const min = ctx.def.qualifier ? minGames(ctx) : 1;
  const inner = sql`
    with ${seasonStatsCte(ctx)}, ${streaksCte(ctx)},
    career as (
      select s.franchise_id,
             count(distinct s.team_season_id)::int as years,
             sum(s.w)::int as wins, sum(s.l)::int as losses, sum(s.t)::int as ties,
             (sum(s.w) + 0.5 * sum(s.t)) / nullif(sum(s.w + s.l + s.t), 0) as win_pct,
             sum(s.w + s.l + s.t)::int as games,
             bool_or(s.season_status <> 'complete') as in_progress,
             max(ws.mx)::int as win_streak, max(ws.seasons) as win_seasons,
             max(lz.mx)::int as loss_streak, max(lz.seasons) as loss_seasons
      from ss s
      left join streaks ws on ws.franchise_id = s.franchise_id and ws.result = 'W'
      left join streaks lz on lz.franchise_id = s.franchise_id and lz.result = 'L'
      group by s.franchise_id
    )
    select
      round((${values[ctx.def.sortKey] ?? sql`wins`})::numeric, 4)::float8 as sort_value,
      0 as season, franchise_id,
      jsonb_build_object(
        'years', years, 'wins', wins, 'losses', losses, 'ties', ties, 'winPct', win_pct::float8,
        'winStreak', coalesce(win_streak, 0), 'winStreakSeasons', coalesce(win_seasons, '{}'),
        'lossStreak', coalesce(loss_streak, 0), 'lossStreakSeasons', coalesce(loss_seasons, '{}')
      ) as data,
      ${franchiseRefs} as refs, in_progress, ${tieKey} as tie_key
    from career where games >= ${min}`;
  return rankRows(ctx, inner);
}

export async function careerPlacementsRecord(ctx: RunContext): Promise<RankedRow[]> {
  const values: Record<string, SQL> = {
    avgPlace: sql`avg_place`,
    bestPlace: sql`best_place`,
    worstPlace: sql`worst_place`,
    playoffs: sql`playoffs`,
    toiletBowls: sql`toilet_bowls`,
  };
  const inner = sql`
    with t as (
      select ts.franchise_id, ts.season, ts.final_place, ts.made_playoffs,
             exists (select 1 from rec_game_result gr where gr.team_season_id = ts.team_season_id and gr.game_type = 'toilet_bowl') as toilet,
             min(ts.final_place) over (partition by ts.franchise_id) as mn,
             max(ts.final_place) over (partition by ts.franchise_id) as mx
      from rec_team_season ts
      where ${seasonCond(sql`ts.league_season_id`, ctx.seasonIds)} and ts.final_place is not null
    ),
    career as (
      select franchise_id,
             min(final_place) as best_place, max(final_place) as worst_place, avg(final_place) as avg_place,
             count(*) filter (where made_playoffs)::int as playoffs,
             count(*) filter (where toilet)::int as toilet_bowls,
             array_agg(season order by season) filter (where final_place = mn) as best_seasons,
             array_agg(season order by season) filter (where final_place = mx) as worst_seasons
      from t group by franchise_id
    )
    select
      round((${values[ctx.def.sortKey] ?? sql`avg_place`})::numeric, 4)::float8 as sort_value,
      0 as season, franchise_id,
      jsonb_build_object(
        'bestPlace', best_place, 'bestPlaceSeasons', best_seasons,
        'worstPlace', worst_place, 'worstPlaceSeasons', worst_seasons,
        'avgPlace', avg_place::float8, 'playoffs', playoffs, 'toiletBowls', toilet_bowls
      ) as data,
      ${franchiseRefs} as refs, false as in_progress, ${tieKey} as tie_key
    from career`;
  return rankRows(ctx, inner);
}

export async function careerLineupsRecord(ctx: RunContext): Promise<RankedRow[]> {
  const values: Record<string, SQL> = {
    perfect: sql`perfect`,
    missed: sql`missed`,
    lineupIq: sql`lineup_iq`,
  };
  const inner = sql`
    with ${seasonStatsCte(ctx)},
    career as (
      select franchise_id, sum(perfect)::int as perfect,
             sum(optimal) - sum(pts_player) as missed,
             sum(pts_player) / nullif(sum(optimal), 0) as lineup_iq,
             sum(player_games) as player_games,
             bool_or(season_status <> 'complete') as in_progress
      from ss group by franchise_id
    )
    select
      round((${values[ctx.def.sortKey] ?? sql`perfect`})::numeric, 4)::float8 as sort_value,
      0 as season, franchise_id,
      jsonb_build_object('perfect', perfect, 'missed', missed::float8, 'lineupIq', lineup_iq::float8) as data,
      ${franchiseRefs} as refs, in_progress, ${tieKey} as tie_key
    from career where player_games > 0`;
  return rankRows(ctx, inner);
}

export async function careerScoringRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  const values: Record<string, SQL> = {
    highScore: sql`high_score`,
    lowScore: sql`low_score`,
    pf: sql`pf`,
    pa: sql`pa`,
    pfpg: sql`pfpg`,
    papg: sql`papg`,
  };
  const inner = sql`
    with ${seasonStatsCte(ctx)},
    tws as (
      select tw.franchise_id, tw.season, tw.week, tw.points,
             max(tw.points) over (partition by tw.franchise_id) as hi,
             min(tw.points) over (partition by tw.franchise_id) as lo
      from rec_team_week tw
      where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)}
        and ${scopeCond(sql`tw.game_type`, q.scope)}
        and ${weeksCond(sql`tw.week`, q.weeks)}
    ),
    extremes as (
      select franchise_id, max(hi) as high_score, min(lo) as low_score,
             array_agg(season || ' WK ' || week order by season, week) filter (where points = hi) as high_when,
             array_agg(season || ' WK ' || week order by season, week) filter (where points = lo) as low_when
      from tws group by franchise_id
    ),
    career as (
      select franchise_id, sum(pf) as pf, sum(pa) as pa, sum(games)::int as games,
             sum(pf) / nullif(sum(games), 0) as pfpg, sum(pa) / nullif(sum(games), 0) as papg,
             bool_or(season_status <> 'complete') as in_progress
      from ss group by franchise_id
    )
    select
      round((${values[ctx.def.sortKey] ?? sql`pf`})::numeric, 4)::float8 as sort_value,
      0 as season, c.franchise_id,
      jsonb_build_object(
        'highScore', e.high_score::float8, 'highScoreWhen', e.high_when,
        'lowScore', e.low_score::float8, 'lowScoreWhen', e.low_when,
        'pf', c.pf::float8, 'pa', c.pa::float8, 'games', c.games, 'pfpg', c.pfpg::float8, 'papg', c.papg::float8
      ) as data,
      jsonb_build_object('franchiseId', c.franchise_id) as refs, c.in_progress,
      lpad(c.franchise_id::text, 6, '0') as tie_key
    from career c join extremes e on e.franchise_id = c.franchise_id where c.games > 0`;
  return rankRows(ctx, inner);
}

export async function careerTransactionsRecord(ctx: RunContext): Promise<RankedRow[]> {
  const values: Record<string, SQL> = {
    trades: sql`trades`,
    claims: sql`claims`,
    spent: sql`spent`,
  };
  const types = (ctx.def.txTypes ?? ["waiver"]).map((t) => sql`${t}`);
  const scopeSql = scopeCond(sql`coalesce(twx.game_type::text, 'regular')`, ctx.q.scope);
  const inner = sql`
    with per_team as (
      select ts.team_season_id, ts.franchise_id, ts.season_status,
             (select count(distinct i.transaction_id)
                from rec_transaction_item i
                left join rec_team_week_all twx on twx.team_season_id = ts.team_season_id and twx.week = i.week
               where i.type = 'trade' and (i.from_team_season_id = ts.team_season_id or i.to_team_season_id = ts.team_season_id)
                 and ${scopeSql}) as trades,
             (select count(distinct i.transaction_id)
                from rec_transaction_item i
                left join rec_team_week_all twx on twx.team_season_id = ts.team_season_id and twx.week = i.week
               where i.type in (${sql.join(types, sql`, `)}) and i.kind = 'player' and i.direction = 'add'
                 and i.to_team_season_id = ts.team_season_id and ${scopeSql}) as claims,
             (select coalesce(sum(i.faab_bid), 0)
                from rec_transaction_item i
                left join rec_team_week_all twx on twx.team_season_id = ts.team_season_id and twx.week = i.week
               where i.type in (${sql.join(types, sql`, `)}) and i.kind = 'player' and i.direction = 'add'
                 and i.to_team_season_id = ts.team_season_id and ${scopeSql}) as spent
      from rec_team_season ts
      where ${seasonCond(sql`ts.league_season_id`, ctx.seasonIds)}
    ),
    career as (
      select franchise_id, sum(trades)::int as trades, sum(claims)::int as claims, sum(spent)::int as spent,
             bool_or(season_status <> 'complete') as in_progress
      from per_team group by franchise_id
    )
    select
      (${values[ctx.def.sortKey] ?? sql`trades`})::float8 as sort_value,
      0 as season, franchise_id,
      jsonb_build_object('trades', trades, 'claims', claims, 'spent', spent) as data,
      ${franchiseRefs} as refs, in_progress, ${tieKey} as tie_key
    from career`;
  return rankRows(ctx, inner);
}
