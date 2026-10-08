import { sql } from "@rfp/db";
import type { SQL } from "@rfp/db";
import { scopeCond, seasonCond, type RankedRow, type RunContext } from "../context";
import { rankRows } from "../rank";
import { minGames, seasonStatsCte, winPctExpr } from "./season-base";

const VALUES: Record<string, { value: SQL; where?: (min: number) => SQL }> = {
  "season.pf.high": { value: sql`pf` },
  "season.pa.high": { value: sql`pa` },
  "season.wins.high": { value: sql`w` },
  "season.losses.high": { value: sql`l` },
  "season.winpct.high": { value: winPctExpr, where: (min) => sql`(w + l + t) >= ${min}` },
  "season.iq.high": {
    value: sql`(pts_player / nullif(optimal, 0))`,
    where: (min) => sql`player_games >= ${min}`,
  },
};

/** Team-season records: totals, record, win % and lineup IQ per franchise-season. */
export async function teamSeasonRecord(ctx: RunContext): Promise<RankedRow[]> {
  const spec = VALUES[ctx.def.id];
  if (!spec) throw new Error(`no team-season spec for ${ctx.def.id}`);
  const inner = sql`
    with ${seasonStatsCte(ctx)}
    select
      round((${spec.value})::numeric, 4)::float8 as sort_value,
      season, franchise_id,
      jsonb_build_object(
        'season', season, 'pf', pf::float8, 'pa', pa::float8, 'games', games,
        'wins', w, 'losses', l, 'ties', t,
        'record', w || '-' || l || case when t > 0 then '-' || t else '' end,
        'winPct', (${winPctExpr})::float8,
        'lineupIq', (pts_player / nullif(optimal, 0))::float8,
        'potential', optimal::float8
      ) as data,
      jsonb_build_object('franchiseId', franchise_id, 'teamSeasonId', team_season_id, 'leagueSeasonId', league_season_id, 'season', season) as refs,
      (season_status <> 'complete') as in_progress,
      concat(season, '-', lpad(team_season_id::text, 6, '0')) as tie_key
    from ss
    where games > 0 and ${spec.where ? spec.where(minGames(ctx)) : sql`true`}`;
  return rankRows(ctx, inner);
}

/** Transaction counts per team season. A trade counts for every team in it; claims for the team that added. */
export async function seasonTransactionsRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q, def } = ctx;
  const types = (def.txTypes ?? ["waiver"]).map((t) => sql`${t}`);
  // A transaction's scope is that team's game type in the transaction's week (preseason week 0 = regular).
  const scopeSql = scopeCond(sql`coalesce(twx.game_type::text, 'regular')`, q.scope);
  const sortKey = { trades: sql`v.trades`, claims: sql`v.claims`, spent: sql`v.spent` }[
    def.sortKey as "trades" | "claims" | "spent"
  ];
  const inner = sql`
    select
      ${sortKey}::float8 as sort_value,
      ts.season, ts.franchise_id,
      jsonb_build_object('season', ts.season, 'trades', v.trades, 'claims', v.claims, 'spent', v.spent) as data,
      jsonb_build_object('franchiseId', ts.franchise_id, 'teamSeasonId', ts.team_season_id, 'leagueSeasonId', ts.league_season_id, 'season', ts.season) as refs,
      (ts.season_status <> 'complete') as in_progress,
      concat(ts.season, '-', lpad(ts.team_season_id::text, 6, '0')) as tie_key
    from rec_team_season ts
    left join lateral (
      select count(distinct i.transaction_id) as trades
      from rec_transaction_item i
      left join rec_team_week_all twx on twx.team_season_id = ts.team_season_id and twx.week = i.week
      where i.type = 'trade' and (i.from_team_season_id = ts.team_season_id or i.to_team_season_id = ts.team_season_id)
        and ${scopeSql}
    ) tr on true
    left join lateral (
      select count(distinct i.transaction_id) as claims, coalesce(sum(i.faab_bid), 0) as spent
      from rec_transaction_item i
      left join rec_team_week_all twx on twx.team_season_id = ts.team_season_id and twx.week = i.week
      where i.type in (${sql.join(types, sql`, `)}) and i.kind = 'player' and i.direction = 'add'
        and i.to_team_season_id = ts.team_season_id and ${scopeSql}
    ) cl on true
    cross join lateral (select tr.trades::int as trades, cl.claims::int as claims, cl.spent::int as spent) v
    where ${seasonCond(sql`ts.league_season_id`, ctx.seasonIds)}
      and ${q.franchise ? sql`ts.franchise_id = ${q.franchise}` : sql`true`}`;
  return rankRows(ctx, inner);
}

/** Share of a team's drafted players still on it, in one continuous stint from the draft, in the final week. */
export async function draftRetentionRecord(ctx: RunContext): Promise<RankedRow[]> {
  const { q } = ctx;
  const inner = sql`
    with picks as (
      select dp.team_season_id, dp.player_id, ls.last_week
      from rec_draft_pick dp join league_season ls on ls.id = dp.league_season_id
      where dp.player_id is not null
        and ${seasonCond(sql`dp.league_season_id`, ctx.seasonIds)}
    ),
    kept as (
      select p.team_season_id, count(distinct p.player_id) as drafted,
             count(distinct p.player_id) filter (where exists (
               select 1 from player_tenure t
               where t.team_season_id = p.team_season_id and t.player_id = p.player_id
                 and t.acquired_via = 'draft' and t.to_week >= p.last_week)) as kept
      from picks p group by p.team_season_id
    )
    select
      round((k.kept::numeric / nullif(k.drafted, 0)), 4)::float8 as sort_value,
      ts.season, ts.franchise_id,
      jsonb_build_object('season', ts.season, 'drafted', k.drafted::int, 'kept', k.kept::int,
                         'retentionPct', (k.kept::numeric / nullif(k.drafted, 0))::float8) as data,
      jsonb_build_object('franchiseId', ts.franchise_id, 'teamSeasonId', ts.team_season_id, 'leagueSeasonId', ts.league_season_id, 'season', ts.season) as refs,
      (ts.season_status <> 'complete') as in_progress,
      concat(ts.season, '-', lpad(ts.team_season_id::text, 6, '0')) as tie_key
    from kept k join rec_team_season ts on ts.team_season_id = k.team_season_id
    where ${q.franchise ? sql`ts.franchise_id = ${q.franchise}` : sql`true`}`;
  return rankRows(ctx, inner);
}
