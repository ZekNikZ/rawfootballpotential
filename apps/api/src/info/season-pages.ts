import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { HttpError } from "../lib/http";
import { inList, type RankedRow } from "../records/context";
import { resolveRows, type Entities } from "../records/entities";

/** Info pages (doc §3.7): unlike records they may read in-progress weeks, and are cached briefly. */

async function entitiesFor(db: Db, teamSeasonIds: readonly number[]): Promise<Entities> {
  const rows: RankedRow[] = [...new Set(teamSeasonIds)].map((teamSeasonId) => ({
    rank: 0,
    total: 0,
    value: 0,
    data: {},
    refs: { teamSeasonId },
    inProgress: false,
  }));
  return (await resolveRows(db, rows)).entities;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function seasonSummary(db: Db, seasonId: number) {
  const [row] = (
    await db.execute<Record<string, unknown>>(sql`
      select ls.id, ls.year, ls.status::text as status, ls.regular_season_weeks, ls.playoff_week_start, ls.last_week,
             ls.playoff_teams, ls.team_count, ls.median_enabled, ls.has_losers_bracket, ls.last_completed_week, l.slug as league
      from league_season ls join league l on l.id = ls.league_id where ls.id = ${seasonId}`)
  ).rows;
  return row;
}

/** Standings after a week (default: the latest week that has any). */
export async function standings(db: Db, seasonId: number, week: number | undefined) {
  const weeks = (
    await db.execute<{ week: number }>(sql`
      select distinct tsw.week from team_season_week tsw join team_season ts on ts.id = tsw.team_season_id
      where ts.league_season_id = ${seasonId} order by 1`)
  ).rows.map((r) => r.week);
  const chosen = week ?? weeks.at(-1) ?? null;
  const rows =
    chosen === null
      ? []
      : (
          await db.execute<Record<string, unknown>>(sql`
            select tsw.team_season_id, ts.franchise_id, ts.division, tsw.week, tsw.wins, tsw.losses, tsw.ties,
                   tsw.pf::float8 as pf, tsw.pa::float8 as pa, tsw.rank, tsw.games_back::float8 as games_back,
                   tsw.clinched, tsw.eliminated, ts.seed, ts.final_place, ts.made_playoffs
            from team_season_week tsw join team_season ts on ts.id = tsw.team_season_id
            where ts.league_season_id = ${seasonId} and tsw.week = ${chosen}
            order by tsw.rank`)
        ).rows;
  const summary = await seasonSummary(db, seasonId);
  return {
    season: summary,
    week: chosen,
    weeks,
    rows: rows.map((r) => ({
      ...r,
      wins: Number(r.wins),
      losses: Number(r.losses),
      ties: Number(r.ties),
    })),
    entities: await entitiesFor(
      db,
      rows.map((r) => Number(r.team_season_id))
    ),
  };
}

type LineupRow = {
  team_week_id: number;
  player_id: number;
  name: string;
  position: string | null;
  nfl_team: string | null;
  slot: string;
  slot_kind: string;
  points: string | null;
  projected: string | null;
  nfl_status: string | null;
  bye: boolean;
};

/** All games of a week (scores are live while the week is in progress), with optional lineups and projections. */
export async function matchups(
  db: Db,
  seasonId: number,
  week: number | undefined,
  withPlayers: boolean
) {
  const summary = await seasonSummary(db, seasonId);
  if (!summary) throw new HttpError(404, "unknown season");
  const lastWeek = Number(summary.last_week);
  const fallback =
    Number(summary.last_completed_week) >= lastWeek
      ? lastWeek
      : Math.max(1, Number(summary.last_completed_week) + 1);
  const chosen = Math.min(Math.max(week ?? fallback, 1), lastWeek);
  const weekStatus = (
    await db.execute<{ status: string }>(
      sql`select status::text as status from league_season_week where league_season_id = ${seasonId} and week = ${chosen}`
    )
  ).rows[0]?.status;

  const teamWeeks = (
    await db.execute<Record<string, unknown>>(sql`
      select tw.id as team_week_id, tw.team_season_id, tw.matchup_id, tw.points::float8 as points, tw.counts, tw.result::text as result,
             tw.is_final, tw.points_overridden,
             (select sum(pw.projected_points)::float8 from player_week pw where pw.team_week_id = tw.id and pw.slot_kind = 'starter') as projected,
             m.game_type::text as game_type, m.bracket::text as bracket, m.bracket_round, m.placement_at_stake, m.is_championship, m.span_weeks
      from team_week tw left join matchup m on m.id = tw.matchup_id
      where tw.league_season_id = ${seasonId} and tw.week = ${chosen}
      order by tw.matchup_id nulls last, tw.team_season_id`)
  ).rows;

  const lineups = new Map<number, LineupRow[]>();
  if (withPlayers && teamWeeks.length) {
    const lr = await db.execute<LineupRow>(sql`
      select pw.team_week_id, pw.player_id, p.full_name as name, pw.position, pw.nfl_team, pw.slot, pw.slot_kind::text as slot_kind,
             pw.points::text as points, pw.projected_points::text as projected, pw.nfl_status,
             (pw.nfl_team is not null and pw.nfl_game_id is null) as bye
      from player_week pw join player p on p.id = pw.player_id
      where pw.team_week_id in (${inList(teamWeeks.map((t) => Number(t.team_week_id)))})
      order by pw.team_week_id, case pw.slot_kind when 'starter' then 0 when 'bench' then 1 when 'ir' then 2 else 3 end, pw.slot, p.full_name`);
    for (const r of lr.rows) {
      const list = lineups.get(r.team_week_id) ?? [];
      list.push(r);
      lineups.set(r.team_week_id, list);
    }
  }

  const team = (t: Record<string, unknown>) => ({
    teamSeasonId: Number(t.team_season_id),
    points: Number(t.points),
    projected: num(t.projected),
    result: t.result as string | null,
    isFinal: Boolean(t.is_final),
    pointsOverridden: Boolean(t.points_overridden),
    lineup: withPlayers
      ? (lineups.get(Number(t.team_week_id)) ?? []).map((l) => ({
          playerId: l.player_id,
          name: l.name,
          position: l.position,
          nflTeam: l.nfl_team,
          slot: l.slot,
          slotKind: l.slot_kind,
          points: num(l.points),
          projected: num(l.projected),
          nflStatus: l.nfl_status,
          onBye: l.bye,
        }))
      : undefined,
  });

  const byMatchup = new Map<number, Record<string, unknown>[]>();
  const idle: Record<string, unknown>[] = [];
  for (const t of teamWeeks) {
    if (t.matchup_id === null) idle.push(t);
    else byMatchup.set(Number(t.matchup_id), [...(byMatchup.get(Number(t.matchup_id)) ?? []), t]);
  }
  const games = [...byMatchup.entries()].map(([matchupId, sides]) => ({
    matchupId,
    gameType: sides[0]?.game_type as string,
    bracket: sides[0]?.bracket as string | null,
    bracketRound: num(sides[0]?.bracket_round),
    placementAtStake: num(sides[0]?.placement_at_stake),
    isChampionship: Boolean(sides[0]?.is_championship),
    spanWeeks: Number(sides[0]?.span_weeks ?? 1),
    counts: Boolean(sides[0]?.counts),
    teams: sides.map(team),
  }));
  return {
    season: summary,
    week: chosen,
    weekStatus: weekStatus ?? "upcoming",
    games,
    /** Teams with no game this week (byes, eliminated): their score is shown but does not count. */
    idle: idle.map(team),
    entities: await entitiesFor(
      db,
      teamWeeks.map((t) => Number(t.team_season_id))
    ),
  };
}

/** Teams of a season: divisions, managers, record, and the current roster. */
export async function teams(db: Db, seasonId: number, withRosters: boolean) {
  const summary = await seasonSummary(db, seasonId);
  const rows = (
    await db.execute<Record<string, unknown>>(sql`
      select ts.id as team_season_id, ts.franchise_id, ts.name, ts.avatar, ts.division, ts.seed, ts.final_place, ts.made_playoffs,
             last.wins, last.losses, last.ties, last.pf::float8 as pf, last.pa::float8 as pa, last.rank
      from team_season ts
      left join lateral (select * from team_season_week x where x.team_season_id = ts.id order by x.week desc limit 1) last on true
      where ts.league_season_id = ${seasonId} order by ts.division nulls last, last.rank nulls last, ts.name`)
  ).rows;
  const rosters = new Map<number, unknown[]>();
  if (withRosters && rows.length) {
    const rr = await db.execute<Record<string, unknown>>(sql`
      select rc.team_season_id, rc.player_id, p.full_name as name, p.position, p.nfl_team, p.injury_status, p.status,
             rc.slot, rc.slot_kind::text as slot_kind, rc.acquired_via::text as acquired_via
      from roster_current rc join player p on p.id = rc.player_id
      where rc.team_season_id in (${inList(rows.map((r) => Number(r.team_season_id)))})
      order by rc.team_season_id, case rc.slot_kind when 'starter' then 0 when 'bench' then 1 when 'ir' then 2 else 3 end, p.full_name`);
    for (const r of rr.rows) {
      const id = Number(r.team_season_id);
      rosters.set(id, [
        ...(rosters.get(id) ?? []),
        {
          playerId: r.player_id,
          name: r.name,
          position: r.position,
          nflTeam: r.nfl_team,
          injuryStatus: r.injury_status,
          status: r.status,
          slot: r.slot,
          slotKind: r.slot_kind,
          acquiredVia: r.acquired_via,
        },
      ]);
    }
  }
  return {
    season: summary,
    teams: rows.map((r) => ({
      ...r,
      wins: num(r.wins),
      losses: num(r.losses),
      ties: num(r.ties),
      roster: withRosters ? (rosters.get(Number(r.team_season_id)) ?? []) : undefined,
    })),
    entities: await entitiesFor(
      db,
      rows.map((r) => Number(r.team_season_id))
    ),
  };
}

/** The transaction feed, newest first. Failed claims are listed (marked) but are never counted in any record. */
export async function transactionFeed(
  db: Db,
  seasonId: number,
  filters: { type?: string; teamSeasonId?: number; limit: number; offset: number }
) {
  const where = sql`x.league_season_id = ${seasonId}
    ${filters.type ? sql`and x.type::text = ${filters.type}` : sql``}
    ${
      filters.teamSeasonId
        ? sql`and exists (select 1 from transaction_item i2 where i2.transaction_id = x.id and (i2.from_team_season_id = ${filters.teamSeasonId} or i2.to_team_season_id = ${filters.teamSeasonId}))`
        : sql``
    }`;
  const total = Number(
    (await db.execute<{ n: string }>(sql`select count(*) as n from "transaction" x where ${where}`))
      .rows[0]?.n ?? 0
  );
  const txs = (
    await db.execute<Record<string, unknown>>(sql`
      select x.id, x.type::text as type, x.status::text as status, x.failure_reason, x.week, x.executed_at, x.creator_team_season_id
      from "transaction" x where ${where}
      order by x.executed_at desc nulls last, x.id desc limit ${filters.limit} offset ${filters.offset}`)
  ).rows;
  const items = txs.length
    ? (
        await db.execute<Record<string, unknown>>(sql`
          select i.transaction_id, i.kind::text as kind, i.direction::text as direction, i.player_id, p.full_name as player, p.position,
                 i.pick_season, i.pick_round, i.pick_original_franchise_id, i.amount, i.faab_bid, i.from_team_season_id, i.to_team_season_id
          from transaction_item i left join player p on p.id = i.player_id
          where i.transaction_id in (${inList(txs.map((t) => Number(t.id)))}) order by i.id`)
      ).rows
    : [];
  const teamIds = [
    ...txs.map((t) => num(t.creator_team_season_id)),
    ...items.flatMap((i) => [num(i.from_team_season_id), num(i.to_team_season_id)]),
  ].filter((v): v is number => v !== null);
  return {
    total,
    transactions: txs.map((t) => ({
      id: Number(t.id),
      type: t.type,
      status: t.status,
      failureReason: t.failure_reason,
      week: Number(t.week),
      executedAt: t.executed_at,
      creatorTeamSeasonId: num(t.creator_team_season_id),
      items: items
        .filter((i) => Number(i.transaction_id) === Number(t.id))
        .map((i) => ({
          kind: i.kind,
          direction: i.direction,
          playerId: num(i.player_id),
          player: i.player,
          position: i.position,
          pickSeason: num(i.pick_season),
          pickRound: num(i.pick_round),
          originalFranchiseId: num(i.pick_original_franchise_id),
          amount: num(i.amount),
          faabBid: num(i.faab_bid),
          fromTeamSeasonId: num(i.from_team_season_id),
          toTeamSeasonId: num(i.to_team_season_id),
        })),
    })),
    entities: await entitiesFor(db, teamIds),
  };
}

/** Future picks (dynasty): who owns what, with the original owner. */
export async function futurePicks(db: Db, leagueId: number) {
  const rows = (
    await db.execute<Record<string, unknown>>(sql`
      select tp.season, tp.round, tp.original_franchise_id, tp.owner_franchise_id, tp.as_of
      from traded_pick tp where tp.league_id = ${leagueId} order by tp.season, tp.round, tp.original_franchise_id`)
  ).rows;
  const franchiseIds = [
    ...new Set(
      rows.flatMap((r) => [Number(r.original_franchise_id), Number(r.owner_franchise_id)])
    ),
  ];
  const refs: RankedRow[] = franchiseIds.map((franchiseId) => ({
    rank: 0,
    total: 0,
    value: 0,
    data: {},
    refs: { franchiseId },
    inProgress: false,
  }));
  return {
    picks: rows.map((r) => ({
      season: Number(r.season),
      round: Number(r.round),
      originalFranchiseId: Number(r.original_franchise_id),
      ownerFranchiseId: Number(r.owner_franchise_id),
      asOf: r.as_of,
    })),
    entities: (await resolveRows(db, refs)).entities,
  };
}

/** Draft boards for a season. */
export async function drafts(db: Db, seasonId: number) {
  const ds = (
    await db.execute<Record<string, unknown>>(sql`
      select d.id, d.kind::text as kind, d.type::text as type, d.status::text as status, d.rounds, d.started_at, d.slot_order
      from draft d where d.league_season_id = ${seasonId} order by d.id`)
  ).rows;
  const picks = ds.length
    ? (
        await db.execute<Record<string, unknown>>(sql`
          select dp.draft_id, dp.pick_no, dp.round, dp.slot, dp.team_season_id, dp.original_team_season_id, dp.player_id, p.full_name as player,
                 p.position, p.nfl_team, dp.amount, dp.is_keeper,
                 (select min(b.week) from nfl_team_week b
                   where b.season = ls.year and b.is_bye
                     and b.nfl_team = coalesce((select a.nfl_team from nfl_team_alias a where a.alias = p.nfl_team limit 1), p.nfl_team)) as bye_week
          from draft_pick dp
          join draft dr on dr.id = dp.draft_id
          join league_season ls on ls.id = dr.league_season_id
          left join player p on p.id = dp.player_id
          where dp.draft_id in (${inList(ds.map((d) => Number(d.id)))}) order by dp.draft_id, dp.pick_no`)
      ).rows
    : [];
  const teamIds = [
    ...picks.flatMap((p) => [num(p.team_season_id), num(p.original_team_season_id)]),
    ...ds.flatMap((d) => Object.values((d.slot_order as Record<string, number> | null) ?? {})),
  ].filter((v): v is number => v !== null);
  return {
    drafts: ds.map((d) => ({
      id: Number(d.id),
      kind: d.kind,
      type: d.type,
      status: d.status,
      rounds: num(d.rounds),
      startedAt: d.started_at,
      slotOrder: d.slot_order,
      picks: picks
        .filter((p) => Number(p.draft_id) === Number(d.id))
        .map((p) => ({
          pickNo: Number(p.pick_no),
          round: Number(p.round),
          slot: num(p.slot),
          teamSeasonId: Number(p.team_season_id),
          originalTeamSeasonId: num(p.original_team_season_id),
          playerId: num(p.player_id),
          player: p.player,
          position: p.position,
          nflTeam: p.nfl_team,
          // Bye week of the player's current NFL team in that season (no schedule data before 2021).
          byeWeek: num(p.bye_week),
          amount: num(p.amount),
          isKeeper: Boolean(p.is_keeper),
        })),
    })),
    entities: await entitiesFor(db, teamIds),
  };
}
