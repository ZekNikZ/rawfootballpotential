import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { inList, type RankedRow } from "../records/context";
import { resolveRows } from "../records/entities";
import {
  explainTrades,
  type ItemExplanation,
  type PickDetail,
  type PlayerDetail,
} from "../records/engines/trade-valuation";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

const playerOut = (d: PlayerDetail | null) =>
  d && {
    value: r3(d.value),
    note: d.note,
    segments: d.segments.map((g) => ({
      year: g.year,
      weight: g.weight,
      weeks: g.weeks.map((w) => ({ week: w.week, points: r3(w.points), holder: w.holder })),
    })),
  };

const pickOut = (p: PickDetail | null) =>
  p && {
    value: r3(p.value),
    averageOf: p.averageOf,
    made: p.made && { playerId: p.made.playerId, detail: playerOut(p.made.detail) },
  };

/**
 * One team's trades in a season, each player and pick broken down week by week (the Trade value page). A player is
 * worth his points from the trade week to the end of the season wherever he was (see trade-valuation.ts), so what
 * the team that received him later did with him never changes it. `lost` for a trade is what the other side's
 * players and picks were worth, and the totals add the trades up.
 */
export async function tradeBreakdown(db: Db, seasonId: number, teamSeasonId: number) {
  const league = Number(
    (
      await db.execute<{ league_id: number }>(
        sql`select league_id from league_season where id = ${seasonId}`
      )
    ).rows[0]?.league_id
  );
  const all = await explainTrades({
    db,
    leagueId: league,
    seasonIds: [seasonId],
    scope: "all",
  });
  const mine = new Set(
    all
      .filter((e) => e.sender === teamSeasonId || e.receiver === teamSeasonId)
      .map((e) => e.transactionId)
  );
  const times = new Map(
    (
      await db.execute<{ id: number; executed_at: string | null }>(sql`
        select id, executed_at from "transaction"
        where id in (${inList([...mine].length ? [...mine] : [0])})`)
    ).rows.map((t) => [Number(t.id), t.executed_at ? new Date(t.executed_at).getTime() : 0])
  );

  const item = (e: ItemExplanation) => ({
    itemId: e.itemId,
    kind: e.kind,
    playerId: e.playerId,
    pickSeason: e.pickSeason,
    pickRound: e.pickRound,
    pickFranchiseId: e.pickFranchiseId,
    counterpartyTeamSeasonId: e.sender === teamSeasonId ? e.receiver : e.sender,
    value: r3(e.value),
    player: playerOut(e.player),
    pick: pickOut(e.pick),
  });

  const trades = [...mine]
    .map((id) => {
      const items = all.filter((e) => e.transactionId === id);
      const received = items.filter((e) => e.receiver === teamSeasonId);
      const sent = items.filter((e) => e.sender === teamSeasonId);
      const gained = received.reduce((s, e) => s + e.value, 0);
      const lost = sent.reduce((s, e) => s + e.value, 0);
      return {
        id,
        week: items[0]?.week ?? 0,
        executedAt: times.get(id) ?? 0,
        partners: [
          ...new Set(
            items
              .flatMap((e) => [e.sender, e.receiver])
              .filter((t) => t !== null && t !== teamSeasonId)
          ),
        ] as number[],
        gained: r3(gained),
        lost: r3(lost),
        net: r3(gained - lost),
        received: received.map(item),
        sent: sent.map(item),
      };
    })
    .sort((a, b) => a.week - b.week || a.executedAt - b.executedAt || a.id - b.id)
    .map(({ executedAt, ...t }) => ({
      ...t,
      executedAt: executedAt ? new Date(executedAt).toISOString() : null,
    }));

  const gained = trades.reduce((s, t) => s + t.gained, 0);
  const lost = trades.reduce((s, t) => s + t.lost, 0);

  // Names for every player referenced anywhere in the detail, and the teams that held them.
  const playerIds = new Set<number>();
  const teamIds = new Set<number>([teamSeasonId]);
  const detailTeams = (d: ReturnType<typeof playerOut>) => {
    for (const g of d?.segments ?? [])
      for (const w of g.weeks) if (w.holder !== null) teamIds.add(w.holder);
  };
  const collect = (it: ReturnType<typeof item>) => {
    if (it.playerId !== null) playerIds.add(it.playerId);
    if (it.pick?.made) playerIds.add(it.pick.made.playerId);
    detailTeams(it.player);
    detailTeams(it.pick?.made?.detail ?? null);
  };
  for (const t of trades) {
    [...t.received, ...t.sent].forEach(collect);
    t.partners.forEach((p) => teamIds.add(p));
  }
  const players: Record<string, { name: string; position: string | null }> = {};
  if (playerIds.size > 0)
    for (const p of (
      await db.execute<{ id: number; full_name: string; position: string | null }>(sql`
        select id, full_name, position from player where id in (${inList([...playerIds])})`)
    ).rows)
      players[String(p.id)] = { name: p.full_name, position: p.position };

  const refs: RankedRow[] = [...teamIds].map((id) => ({
    rank: 0,
    total: 0,
    value: 0,
    data: {},
    refs: { teamSeasonId: id },
    inProgress: false,
  }));

  return {
    teamSeasonId,
    summary: {
      trades: trades.length,
      gained: r3(gained),
      lost: r3(lost),
      net: r3(gained - lost),
      netPerTrade: trades.length ? r3((gained - lost) / trades.length) : null,
    },
    trades,
    players,
    entities: (await resolveRows(db, refs)).entities,
  };
}
