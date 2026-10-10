import { sql } from "@rfp/db";
import type { SQL } from "@rfp/db";
import { scopeCond, seasonCond, weeksCond, type RankedRow, type RunContext } from "../context";
import { rankRows } from "../rank";
import { pointsSince, stintEnd } from "./points-since";
import { itemValuesCte, tradeAccounting, tradeValuations } from "./trade-valuation";
import { minGames } from "./season-base";
import { playerFilters } from "./players";

/** The "estimated value" variants of the trade and drop-regret records (see trade-valuation.ts). */
const isEstimate = (id: string): boolean => id.endsWith(".est");

/** A player on a bye (his NFL team had no game) or not active that week. */
const deadPlayer = sql`((pw.nfl_game_id is null and pw.nfl_team is not null and pw.points = 0)
                        or (pw.nfl_status is not null and upper(pw.nfl_status) <> 'ACT'))`;

/** A starter's points against his projection. */
export async function playerProjectionRecord(ctx: RunContext): Promise<RankedRow[]> {
  const inner = sql`
    select
      round((pw.points - pw.projected_points)::numeric, 3)::float8 as sort_value,
      pw.season, pw.franchise_id,
      jsonb_build_object('season', pw.season, 'week', pw.week, 'player', p.full_name, 'position', pw.position,
                         'points', pw.points::float8, 'projected', pw.projected_points::float8,
                         'delta', (pw.points - pw.projected_points)::float8) as data,
      jsonb_build_object('franchiseId', pw.franchise_id, 'teamSeasonId', pw.team_season_id, 'playerId', pw.player_id,
                         'leagueSeasonId', pw.league_season_id, 'season', pw.season, 'week', pw.week) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(pw.season, '-', lpad(pw.week::text, 2, '0'), '-', lpad(pw.team_season_id::text, 6, '0'), '-', lpad(pw.player_id::text, 7, '0')) as tie_key
    from rec_player_week pw
    join player p on p.id = pw.player_id
    join league_season ls on ls.id = pw.league_season_id
    where ${playerFilters(ctx)}
      and pw.projected_points > 0 and not ${deadPlayer}`;
  return rankRows(ctx, inner);
}

/** Starter points from players in a single NFL game. */
export async function nflStackRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  const inner = sql`
    with s as (
      select pw.team_week_id, pw.nfl_game_id, count(*) as players, sum(pw.points) as pts
      from rec_player_week pw
      where pw.slot_kind = 'starter' and pw.nfl_game_id is not null and pw.points is not null and pw.counts
        and ${seasonCond(sql`pw.league_season_id`, ctx.seasonIds)}
        and ${scopeCond(sql`pw.game_type`, q.scope)}
        and ${weeksCond(sql`pw.week`, q.weeks)}
        and ${q.franchise ? sql`pw.franchise_id = ${q.franchise}` : sql`true`}
      group by pw.team_week_id, pw.nfl_game_id
    )
    select
      round(s.pts::numeric, 3)::float8 as sort_value,
      tw.season, tw.franchise_id,
      jsonb_build_object('season', tw.season, 'week', tw.week, 'nflGame', g.away_team || ' @ ' || g.home_team,
                         'players', s.players::int, 'stackPoints', s.pts::float8,
                         'share', (s.pts / nullif(tw.points, 0))::float8) as data,
      jsonb_build_object('franchiseId', tw.franchise_id, 'teamSeasonId', tw.team_season_id,
                         'opponentTeamSeasonId', tw.opponent_team_season_id, 'opponentFranchiseId', ots.franchise_id,
                         'leagueSeasonId', tw.league_season_id, 'season', tw.season, 'week', tw.week) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(tw.season, '-', lpad(tw.week::text, 2, '0'), '-', lpad(tw.team_season_id::text, 6, '0'), '-', s.nfl_game_id) as tie_key
    from s
    join rec_team_week tw on tw.team_week_id = s.team_week_id
    join nfl_game g on g.id = s.nfl_game_id
    join league_season ls on ls.id = tw.league_season_id
    left join team_season ots on ots.id = tw.opponent_team_season_id
    where ${q.opponent ? sql`ots.franchise_id = ${q.opponent}` : sql`true`}`;
  return rankRows(ctx, inner);
}

/** Waiver pickups: starter points a claimed player scored for the claiming team until it let him go. */
export async function pickupRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  const value: Record<string, { sort: SQL; where: SQL }> = {
    "pickup.best": { sort: sql`sp.pts`, where: sql`true` },
    "pickup.value": { sort: sql`(sp.pts / c.faab_bid)`, where: sql`c.faab_bid >= 1` },
    "pickup.faab-per-point": {
      sort: sql`(c.faab_bid / greatest(sp.pts, 1))`,
      where: sql`c.faab_bid >= 1`,
    },
  };
  const spec = value[ctx.def.id];
  if (!spec) throw new Error(`no pickup spec for ${ctx.def.id}`);
  const inner = sql`
    with c as (
      select i.item_id, i.league_season_id, i.season, i.week, i.to_team_season_id as team_season_id, i.player_id,
             i.faab_bid, ts.franchise_id
      from rec_transaction_item i join team_season ts on ts.id = i.to_team_season_id
      where i.type = 'waiver' and i.kind = 'player' and i.direction = 'add'
        and ${seasonCond(sql`i.league_season_id`, ctx.seasonIds)}
        and ${q.franchise ? sql`ts.franchise_id = ${q.franchise}` : sql`true`}
    )
    select
      round((${spec.sort})::numeric, 4)::float8 as sort_value,
      c.season, c.franchise_id,
      jsonb_build_object('season', c.season, 'week', c.week, 'player', p.full_name, 'amount', c.faab_bid,
                         'starterPoints', sp.pts::float8, 'starts', sp.starts::int,
                         'pointsPerDollar', (sp.pts / nullif(c.faab_bid, 0))::float8,
                         'dollarsPerPoint', (c.faab_bid / greatest(sp.pts, 1))::float8) as data,
      jsonb_build_object('franchiseId', c.franchise_id, 'teamSeasonId', c.team_season_id, 'playerId', c.player_id,
                         'leagueSeasonId', c.league_season_id, 'season', c.season, 'week', c.week) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(c.season, '-', lpad(c.week::text, 2, '0'), '-', lpad(c.item_id::text, 8, '0')) as tie_key
    from c
    join player p on p.id = c.player_id
    join league_season ls on ls.id = c.league_season_id
    cross join lateral (
      select coalesce(sum(pw.points), 0) as pts, count(*) as starts
      from rec_player_week pw
      where pw.team_season_id = c.team_season_id and pw.player_id = c.player_id
        and pw.slot_kind = 'starter' and pw.counts and pw.points is not null
        and ${scopeCond(sql`pw.game_type`, q.scope)}
        and pw.week between c.week and coalesce(${stintEnd(sql`c.team_season_id`, sql`c.player_id`, sql`c.week`)}, c.week - 1)
    ) sp
    where ${spec.where}`;
  return rankRows(ctx, inner);
}

/** Points a dropped player scored as a starter for other teams over the rest of that season. */
export async function dropRegretRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  const inner = sql`
    with d as (
      select t.team_season_id, t.player_id, t.to_week, ts.franchise_id, ts.league_season_id, ls.year as season
      from player_tenure t
      join team_season ts on ts.id = t.team_season_id
      join league_season ls on ls.id = ts.league_season_id and ls.enabled
      where t.left_via = 'drop' and ${seasonCond(sql`ts.league_season_id`, ctx.seasonIds)}
        and ${q.franchise ? sql`ts.franchise_id = ${q.franchise}` : sql`true`}
    )
    select
      round(x.pts::numeric, 3)::float8 as sort_value,
      d.season, d.franchise_id,
      jsonb_build_object('season', d.season, 'week', d.to_week + 1, 'player', p.full_name, 'points', x.pts::float8,
                         'startedFor', x.teams) as data,
      jsonb_build_object('franchiseId', d.franchise_id, 'teamSeasonId', d.team_season_id, 'playerId', d.player_id,
                         'leagueSeasonId', d.league_season_id, 'season', d.season, 'week', d.to_week + 1) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(d.season, '-', lpad(d.to_week::text, 2, '0'), '-', lpad(d.team_season_id::text, 6, '0'), '-', lpad(d.player_id::text, 7, '0')) as tie_key
    from d
    join player p on p.id = d.player_id
    join league_season ls on ls.id = d.league_season_id
    cross join lateral (
      select sum(pw.points) as pts, string_agg(distinct ots.name, ', ') as teams
      from rec_player_week pw join team_season ots on ots.id = pw.team_season_id
      where pw.player_id = d.player_id and pw.league_season_id = d.league_season_id
        and pw.week > d.to_week and pw.team_season_id <> d.team_season_id
        and pw.slot_kind = 'starter' and pw.counts and pw.points is not null
        and ${scopeCond(sql`pw.game_type`, q.scope)}
    ) x
    where x.pts is not null`;
  return rankRows(ctx, inner);
}

/**
 * Trade value: for each side, the starter points the players it received scored for it from the trade to the end
 * of that stint. "Best trade" ranks sides; "most lopsided" ranks trades by the gap between the best and worst side.
 */
export async function tradeValueRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  const lopsided = ctx.def.id.startsWith("trade.lopsided");
  // The estimate values lineup contribution, picks and the dynasty follow-up, and follows a traded player through
  // the trades his new team made with him (see trade-valuation.ts).
  const chained = isEstimate(ctx.def.id)
    ? await tradeValuations({
        db: ctx.db,
        leagueId: ctx.leagueId,
        seasonIds: ctx.seasonIds,
        scope: q.scope,
        chain: true,
      })
    : null;
  const inner = sql`
    with ${chained ? itemValuesCte(chained) : sql`iv(item_id, v) as (select null::int, null::float8 where false)`},
    items as (
      select i.item_id, i.transaction_id, i.league_season_id, i.season, i.week, i.to_team_season_id as side, i.player_id,
             i.pick_season, i.pick_round
      from rec_transaction_item i
      where i.type = 'trade' and (i.kind = 'player' ${chained ? sql`or i.kind = 'pick'` : sql``})
        and i.to_team_season_id is not null
        and ${seasonCond(sql`i.league_season_id`, ctx.seasonIds)}
    ),
    got as (
      select it.transaction_id, it.league_season_id, it.season, it.week, it.side,
             sum(sp.pts) as pts,
             string_agg(coalesce(p.full_name, concat(it.pick_season, ' round ', it.pick_round, ' pick')), ', '
                        order by sp.pts desc, coalesce(p.full_name, '')) as names
      from items it
      left join player p on p.id = it.player_id
      cross join lateral (
        select ${
          chained
            ? sql`coalesce((select iv.v from iv where iv.item_id = it.item_id), 0)`
            : pointsSince(
                sql`it.side`,
                sql`it.player_id`,
                sql`it.week`,
                0,
                scopeCond(sql`pw.game_type`, q.scope)
              )
        } as pts
      ) sp
      group by it.transaction_id, it.league_season_id, it.season, it.week, it.side
    ),
    sides as (
      select g.*, ts.franchise_id,
             (select string_agg(coalesce(p.full_name, concat(j.pick_season, ' round ', j.pick_round, ' pick')), ', '
                                order by coalesce(p.full_name, ''))
                from rec_transaction_item j left join player p on p.id = j.player_id
               where j.transaction_id = g.transaction_id and j.from_team_season_id = g.side and j.type = 'trade'
                 and (j.kind = 'player' ${chained ? sql`or j.kind = 'pick'` : sql``})) as gave,
             count(*) over (partition by g.transaction_id) as side_count,
             sum(g.pts) over (partition by g.transaction_id) as total,
             max(g.pts) over (partition by g.transaction_id) as mx,
             min(g.pts) over (partition by g.transaction_id) as mn,
             array_agg(g.side) over (partition by g.transaction_id) as side_ids
      from got g join team_season ts on ts.id = g.side
    ),
    picked as (
      ${
        lopsided
          ? sql`select distinct on (transaction_id) *, mx - mn as score, mn as other
                from sides where side_count >= 2 and pts = mx
                order by transaction_id, side`
          : sql`select *, pts as score, (total - pts) / nullif(side_count - 1, 0) as other from sides`
      }
    )
    select
      round(pk.score::numeric, 3)::float8 as sort_value,
      pk.season, pk.franchise_id,
      jsonb_build_object('season', pk.season, 'week', pk.week, 'got', pk.names, 'gave', pk.gave, 'sidePoints', round(pk.pts::numeric, 3)::float8,
                         'otherPoints', round(pk.other::numeric, 3)::float8,
                         'difference', round((pk.pts - pk.other)::numeric, 3)::float8) as data,
      jsonb_build_object('franchiseId', pk.franchise_id, 'teamSeasonId', pk.side, 'teamSeasonIds', array_remove(pk.side_ids, pk.side),
                         'leagueSeasonId', pk.league_season_id, 'season', pk.season, 'week', pk.week) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(pk.season, '-', lpad(pk.week::text, 2, '0'), '-', lpad(pk.transaction_id::text, 8, '0'), '-', lpad(pk.side::text, 6, '0')) as tie_key
    from picked pk join league_season ls on ls.id = pk.league_season_id
    where ${q.franchise ? sql`pk.franchise_id = ${q.franchise}` : sql`true`}`;
  return rankRows(ctx, inner);
}

/** Players rostered by the most franchises (all-time, or teams within one season). */
export async function journeymanRecord(ctx: RunContext): Promise<RankedRow[]> {
  const bySeason = ctx.def.id === "journeyman.season";
  const group = bySeason ? sql`t.player_id, ts.league_season_id, ls.year` : sql`t.player_id`;
  const inner = sql`
    select
      (count(distinct ${bySeason ? sql`ts.id` : sql`ts.franchise_id`}) + least(count(*), 999) / 1000.0)::float8 as sort_value,
      ${bySeason ? sql`ls.year` : sql`0`} as season, 0 as franchise_id,
      jsonb_build_object('player', p.full_name,
                         'franchises', count(distinct ${bySeason ? sql`ts.id` : sql`ts.franchise_id`})::int,
                         'stints', count(*)::int,
                         ${bySeason ? sql`'season', ls.year` : sql`'seasons', array_agg(distinct ls.year order by ls.year)`}) as data,
      jsonb_build_object('playerId', t.player_id${bySeason ? sql`, 'leagueSeasonId', ts.league_season_id, 'season', ls.year` : sql``}) as refs,
      bool_or(ls.status <> 'complete') as in_progress,
      ${bySeason ? sql`concat(ls.year, '-', lpad(t.player_id::text, 7, '0'))` : sql`lpad(t.player_id::text, 7, '0')`} as tie_key
    from player_tenure t
    join team_season ts on ts.id = t.team_season_id
    join league_season ls on ls.id = ts.league_season_id and ls.enabled
    join player p on p.id = t.player_id
    where ${seasonCond(sql`ts.league_season_id`, ctx.seasonIds)}
    group by ${group}, p.full_name`;
  return rankRows(ctx, inner);
}

/**
 * Stints of one player on one franchise's roster, counted in league weeks across seasons (the last week of a
 * season and the first of the next are consecutive). Loyalty ranks the longest stint; the boomerang is the
 * longest gap between two stints of the same player on the same franchise.
 */
export async function loyaltyRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  const boomerang = ctx.def.id === "boomerang.longest";
  const inner = sql`
    with idx as (
      select league_season_id, week, dense_rank() over (order by season, week) as i, season
      from (select distinct league_season_id, season, week from rec_team_week_all
            where ${seasonCond(sql`league_season_id`, ctx.seasonIds)}) x
    ),
    pw as (
      select pw.franchise_id, pw.player_id, ix.i, ix.season, ix.week, (ls.status <> 'complete') as prog
      from rec_player_week pw join idx ix on ix.league_season_id = pw.league_season_id and ix.week = pw.week
      join league_season ls on ls.id = pw.league_season_id
      where ${seasonCond(sql`pw.league_season_id`, ctx.seasonIds)}
        and ${q.franchise ? sql`pw.franchise_id = ${q.franchise}` : sql`true`}
    ),
    isl as (
      select franchise_id, player_id, count(*) as weeks, min(i) as lo, max(i) as hi, bool_or(prog) as prog,
             (array_agg(season || ' WK ' || week order by i))[1] as from_when,
             (array_agg(season || ' WK ' || week order by i desc))[1] as to_when
      from (select pw.*, i - row_number() over (partition by franchise_id, player_id order by i) as grp from pw) g
      group by franchise_id, player_id, grp
    )
    ${
      boomerang
        ? sql`, gaps as (
        select isl.*, lag(hi) over (w) as prev_hi, lag(to_when) over (w) as prev_to
        from isl window w as (partition by franchise_id, player_id order by lo)
      )
      select (lo - prev_hi - 1)::float8 as sort_value, 0 as season, g.franchise_id,
             jsonb_build_object('player', p.full_name, 'weeksAway', (lo - prev_hi - 1)::int,
                                'span', g.prev_to || ' / ' || g.from_when) as data,
             jsonb_build_object('franchiseId', g.franchise_id, 'playerId', g.player_id) as refs,
             g.prog as in_progress,
             lpad(g.franchise_id::text, 6, '0') || '-' || lpad(g.player_id::text, 7, '0') || '-' || lpad(lo::text, 5, '0') as tie_key
      from gaps g join player p on p.id = g.player_id
      where prev_hi is not null`
        : sql`
      select weeks::float8 as sort_value, 0 as season, g.franchise_id,
             jsonb_build_object('player', p.full_name, 'weeks', weeks::int, 'span', g.from_when || ' - ' || g.to_when) as data,
             jsonb_build_object('franchiseId', g.franchise_id, 'playerId', g.player_id) as refs,
             g.prog as in_progress,
             lpad(g.franchise_id::text, 6, '0') || '-' || lpad(g.player_id::text, 7, '0') || '-' || lpad(lo::text, 5, '0') as tie_key
      from isl g join player p on p.id = g.player_id`
    }`;
  return rankRows(ctx, inner);
}

/** Draft picks against what the player did that season, and auction price against the same. */
export async function draftValueRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  const id = ctx.def.id;
  const base = sql`
    picks as (
      select dp.*, pl.full_name,
             coalesce((select sum(pw.points) from rec_player_week pw
                       where pw.player_id = dp.player_id and pw.league_season_id = dp.league_season_id
                         and pw.points is not null), 0) as pts,
             coalesce((select mode() within group (order by pw.position) from rec_player_week pw
                       where pw.player_id = dp.player_id and pw.league_season_id = dp.league_season_id), pl.position) as pos
      from rec_draft_pick dp join player pl on pl.id = dp.player_id
      where dp.player_id is not null and ${seasonCond(sql`dp.league_season_id`, ctx.seasonIds)}
    )`;
  const common = sql`
      pk.season, pk.franchise_id,
      jsonb_build_object('season', pk.season, 'player', pk.full_name, 'round', pk.round,
                         'pick', 'R' || pk.round || ' #' || pk.pick_no, 'amount', pk.amount,
                         'points', pk.pts::float8`;
  const refs = sql`
      jsonb_build_object('franchiseId', pk.franchise_id, 'teamSeasonId', pk.team_season_id, 'playerId', pk.player_id,
                         'leagueSeasonId', pk.league_season_id, 'season', pk.season) as refs,
      (ls.status <> 'complete') as in_progress`;
  const franchiseOnly = q.franchise ? sql`pk.franchise_id = ${q.franchise}` : sql`true`;

  if (id === "draft.steal" || id === "draft.bust") {
    // With a position filter, steals are measured against that position's picks only (owner decision, 2026-10-07).
    const covered = ctx.def.positionOptions ?? [];
    const stealPositions = q.positions?.length
      ? covered.filter((p) => q.positions!.includes(p))
      : covered;
    const inner = sql`
      with ${base},
      pool as (select * from picks where pos in (${sql.join(
        (stealPositions.length ? stealPositions : ["none"]).map((p) => sql`${p}`),
        sql`, `
      )})),
      ranked as (
        select pool.*,
               rank() over (partition by draft_id order by pts desc) as finish,
               rank() over (partition by draft_id order by pick_no) as pick_rank
        from pool
      )
      select (pk.pick_rank - pk.finish)::float8 as sort_value,
        ${common}, 'finish', pk.finish::int, 'gain', (pk.pick_rank - pk.finish)::int) as data,
        ${refs},
        concat(pk.season, '-', lpad(pk.draft_id::text, 5, '0'), '-', lpad(pk.pick_no::text, 4, '0')) as tie_key
      from ranked pk join league_season ls on ls.id = pk.league_season_id
      where ${franchiseOnly}`;
    return rankRows(ctx, inner);
  }
  if (id === "draft.best-by-round") {
    const inner = sql`
      with ${base},
      best as (select distinct on (round) * from picks order by round, pts desc, season, pick_no)
      select pk.round::float8 as sort_value,
        ${common}) as data,
        ${refs},
        lpad(pk.round::text, 3, '0') as tie_key
      from best pk join league_season ls on ls.id = pk.league_season_id
      where ${franchiseOnly}`;
    return rankRows(ctx, inner);
  }
  // auction.value / auction.bust
  const value =
    id === "auction.value" ? sql`(pk.pts / pk.amount)` : sql`(pk.amount / greatest(pk.pts, 1))`;
  const inner = sql`
    with ${base}
    select round((${value})::numeric, 4)::float8 as sort_value,
      ${common}, 'pointsPerDollar', (pk.pts / pk.amount)::float8, 'dollarsPerPoint', (pk.amount / greatest(pk.pts, 1))::float8) as data,
      ${refs},
      concat(pk.season, '-', lpad(pk.draft_id::text, 5, '0'), '-', lpad(pk.pick_no::text, 4, '0')) as tie_key
    from picks pk join league_season ls on ls.id = pk.league_season_id
    where pk.draft_type = 'auction' and pk.amount >= 1 and ${franchiseOnly}`;
  return rankRows(ctx, inner);
}

/**
 * Overall trade value per franchise. Every player and draft pick moved in a trade is valued for the team that
 * received it (trade-valuation.ts: what a player added to its best lineup, a pick as the player it became, dynasty
 * players also next season). A side gains the value of what it received and loses the value of what it sent away;
 * its net is gained - lost. A player traded on is not followed (the re-trade's return is credited in that trade).
 * "Total" ranks the sum of the nets, "average" the net per trade (with a minimum number of trades). FAAB is not valued.
 */
export async function careerTradeValueRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  const average = ctx.def.id === "career.trade-value.avg";
  const min = average ? minGames(ctx) : 1;
  const { values, counted } = await tradeAccounting({
    db: ctx.db,
    leagueId: ctx.leagueId,
    seasonIds: ctx.seasonIds,
    scope: q.scope,
    chain: true,
  });
  const inner = sql`
    with ${itemValuesCte(values, counted)},
    items as (
      select i.item_id, i.transaction_id, i.from_team_season_id as sender, i.to_team_season_id as receiver
      from rec_transaction_item i
      where i.type = 'trade' and i.kind in ('player', 'pick')
        and i.from_team_season_id is not null and i.to_team_season_id is not null
        and ${seasonCond(sql`i.league_season_id`, ctx.seasonIds)}
    ),
    vals as (
      select it.transaction_id, it.sender, it.receiver, coalesce(iv.v, 0) as pts, coalesce(iv.c, 0) as counted
      from items it left join iv on iv.item_id = it.item_id
    ),
    sides as (
      select transaction_id, team_season_id, sum(gained) as gained, sum(counted_gained) as counted_gained,
             sum(lost) as lost, sum(counted_lost) as counted_lost
      from (
        select transaction_id, receiver as team_season_id, pts as gained, counted as counted_gained, 0 as lost, 0 as counted_lost from vals
        union all
        select transaction_id, sender, 0, 0, pts, counted from vals
      ) x
      group by transaction_id, team_season_id
    ),
    per as (
      -- gained and net are the totals (a re-trade's return counted once); a trade is won or lost on the net shown on its card
      select ts.franchise_id, s.counted_gained as gained, s.counted_lost as lost,
             round((s.counted_gained - s.counted_lost)::numeric, 3) as net,
             round((s.gained - s.lost)::numeric, 3) as card_net,
             (ls.status <> 'complete') as prog
      from sides s
      join team_season ts on ts.id = s.team_season_id
      join league_season ls on ls.id = ts.league_season_id
    ),
    career as (
      select franchise_id, count(*)::int as trades,
             count(*) filter (where card_net > 0)::int as wins, count(*) filter (where card_net < 0)::int as losses,
             count(*) filter (where card_net = 0)::int as ties,
             sum(gained) as gained, sum(lost) as lost, sum(net) as net, bool_or(prog) as in_progress
      from per group by franchise_id
    )
    select
      round((${average ? sql`net / trades` : sql`net`})::numeric, 3)::float8 as sort_value,
      0 as season, franchise_id,
      jsonb_build_object('trades', trades, 'record', wins || '-' || losses || case when ties > 0 then '-' || ties else '' end,
                         'gained', round(gained::numeric, 1)::float8, 'lost', round(lost::numeric, 1)::float8,
                         'net', net::float8, 'netPerTrade', round((net / trades)::numeric, 3)::float8) as data,
      jsonb_build_object('franchiseId', franchise_id) as refs, in_progress,
      lpad(franchise_id::text, 6, '0') as tie_key
    from career where trades >= ${min}`;
  return rankRows(ctx, inner);
}
