import { sql } from "@rfp/db";
import { scopeCond, seasonCond, type RankedRow, type RunContext } from "../context";
import { rankRows } from "../rank";

/** Highest winning FAAB bid on a single waiver claim. Failed claims never reach rec_transaction_item. */
export async function faabClaimRecord(ctx: RunContext): Promise<RankedRow[]> {
  const scopeSql = scopeCond(sql`coalesce(twx.game_type::text, 'regular')`, ctx.q.scope);
  const inner = sql`
    select
      i.faab_bid::float8 as sort_value,
      i.season, ts.franchise_id,
      jsonb_build_object('season', i.season, 'week', i.week, 'player', p.full_name, 'amount', i.faab_bid) as data,
      jsonb_build_object('franchiseId', ts.franchise_id, 'teamSeasonId', i.to_team_season_id, 'playerId', i.player_id,
                         'leagueSeasonId', i.league_season_id, 'season', i.season, 'week', i.week) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(i.season, '-', lpad(i.week::text, 2, '0'), '-', lpad(i.item_id::text, 8, '0')) as tie_key
    from rec_transaction_item i
    join team_season ts on ts.id = i.to_team_season_id
    join player p on p.id = i.player_id
    join league_season ls on ls.id = i.league_season_id
    left join rec_team_week_all twx on twx.team_season_id = i.to_team_season_id and twx.week = i.week
    where i.type = 'waiver' and i.kind = 'player' and i.direction = 'add' and i.faab_bid is not null
      and ${seasonCond(sql`i.league_season_id`, ctx.seasonIds)} and ${scopeSql}`;
  return rankRows(ctx, inner);
}

/** Highest auction price paid for a draft pick. */
export async function draftPriceRecord(ctx: RunContext): Promise<RankedRow[]> {
  const inner = sql`
    select
      dp.amount::float8 as sort_value,
      dp.season, dp.franchise_id,
      jsonb_build_object('season', dp.season, 'player', p.full_name, 'amount', dp.amount,
                         'pick', 'R' || dp.round || ' #' || dp.pick_no) as data,
      jsonb_build_object('franchiseId', dp.franchise_id, 'teamSeasonId', dp.team_season_id, 'playerId', dp.player_id,
                         'leagueSeasonId', dp.league_season_id, 'season', dp.season) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(dp.season, '-', lpad(dp.pick_no::text, 4, '0')) as tie_key
    from rec_draft_pick dp
    join player p on p.id = dp.player_id
    join league_season ls on ls.id = dp.league_season_id
    where dp.amount is not null and dp.draft_type = 'auction' and ${seasonCond(sql`dp.league_season_id`, ctx.seasonIds)}`;
  return rankRows(ctx, inner);
}

/**
 * Most moved player: the number of distinct completed transactions that involve him (doc §2): a trade is 1, a drop
 * is 1, another team claiming him is 1 more. Failed claims never count (they are not in rec_transaction_item).
 */
export async function mostMovedRecord(ctx: RunContext): Promise<RankedRow[]> {
  const inner = sql`
    select
      count(distinct i.transaction_id)::float8 as sort_value,
      0 as season, 0 as franchise_id,
      jsonb_build_object('player', p.full_name, 'moves', count(distinct i.transaction_id)::int,
                         'seasons', array_agg(distinct i.season order by i.season)) as data,
      jsonb_build_object('playerId', i.player_id) as refs,
      false as in_progress,
      lpad(i.player_id::text, 7, '0') as tie_key
    from rec_transaction_item i
    join player p on p.id = i.player_id
    where i.kind = 'player' and ${seasonCond(sql`i.league_season_id`, ctx.seasonIds)}
    group by i.player_id, p.full_name`;
  return rankRows(ctx, inner);
}

/**
 * Trades: "largest" counts distinct players moved (picks and FAAB are shown but don't count); "broadest" counts
 * distinct teams. A trade's scope is its week's game type (regular before the playoffs, playoffs from then on).
 */
export async function tradeRecord(ctx: RunContext): Promise<RankedRow[]> {
  const sortKey = ctx.def.sortKey === "teamCount" ? sql`c.team_count` : sql`t.players`;
  const weekType = sql`case when t.week >= ls.playoff_week_start then 'playoffs' else 'regular' end`;
  const inner = sql`
    with t as (
      select i.transaction_id, i.league_season_id, i.season, i.week,
             count(distinct i.player_id) filter (where i.kind = 'player') as players,
             count(*) filter (where i.kind = 'pick') as picks,
             coalesce(sum(i.amount) filter (where i.kind = 'faab'), 0) as faab,
             string_agg(distinct p.full_name, ', ') filter (where i.kind = 'player') as player_names,
             array_remove(array(select distinct x from unnest(array_agg(i.from_team_season_id) || array_agg(i.to_team_season_id)) x), null) as team_ids
      from rec_transaction_item i
      left join player p on p.id = i.player_id
      where i.type = 'trade' and ${seasonCond(sql`i.league_season_id`, ctx.seasonIds)}
      group by i.transaction_id, i.league_season_id, i.season, i.week
    )
    select
      (${sortKey})::float8 as sort_value,
      t.season, 0 as franchise_id,
      jsonb_build_object('season', t.season, 'week', t.week, 'players', t.players::int, 'picks', t.picks::int,
                         'faab', t.faab::int, 'teamCount', cardinality(t.team_ids), 'playerNames', t.player_names) as data,
      jsonb_build_object('teamSeasonIds', t.team_ids, 'leagueSeasonId', t.league_season_id, 'season', t.season, 'week', t.week) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(t.season, '-', lpad(t.week::text, 2, '0'), '-', lpad(t.transaction_id::text, 8, '0')) as tie_key
    from t
    cross join lateral (select cardinality(t.team_ids) as team_count) c
    join league_season ls on ls.id = t.league_season_id
    where ${scopeCond(weekType, ctx.q.scope)}`;
  return rankRows(ctx, inner);
}
