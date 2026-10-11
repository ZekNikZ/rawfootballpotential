import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { inList } from "../records/context";
import { tradeValuations } from "../records/engines/trade-valuation";
import type { Entities } from "../records/entities";
import { franchiseEntities, selectedSeasons } from "./league-data";

export interface TradePartnerCell {
  /** Completed trades the two franchises made with each other. */
  trades: number;
  /** Players and picks the row franchise received from the column franchise / sent to it. */
  received: number;
  sent: number;
  /** Estimated value (points) the row franchise gained from the column franchise, net of what it sent. */
  net: number;
}

export interface TradePartners {
  /** Franchise ids that made at least one trade. */
  franchises: number[];
  /** matrix[a][b]: a's trades with b. The net value is zero-sum: matrix[a][b].net = -matrix[b][a].net. */
  matrix: Record<number, Record<number, TradePartnerCell>>;
  entities: Entities;
  seasonsIncluded: number[];
  availableFrom: number | null;
}

/**
 * Franchise x franchise trade history (the trade partners matrix). Every moved player or pick is an item from one
 * team to another, so a three-team trade splits into the pairs that actually exchanged assets. The net value uses
 * the same estimated trade value as the Trade Value page (rest-of-season production), so it is zero-sum per pair.
 */
export async function tradePartners(
  db: Db,
  leagueId: number,
  query: { seasons?: unknown }
): Promise<TradePartners> {
  const seasons = await selectedSeasons(db, leagueId, query.seasons);
  const ids = seasons.map((s) => s.id);
  const matrix: TradePartners["matrix"] = {};
  const empty = (): TradePartners => ({
    franchises: [],
    matrix,
    entities: { franchises: {}, teamSeasons: {}, managers: {} },
    seasonsIncluded: seasons.map((s) => s.year),
    availableFrom: seasons[0]?.year ?? null,
  });
  if (ids.length === 0) return empty();

  const items = (
    await db.execute<{ item_id: number; transaction_id: number; f: number; t: number }>(sql`
      select i.item_id, i.transaction_id, fts.franchise_id as f, tts.franchise_id as t
      from rec_transaction_item i
      join team_season fts on fts.id = i.from_team_season_id
      join team_season tts on tts.id = i.to_team_season_id
      where i.type = 'trade' and i.kind in ('player', 'pick') and i.league_id = ${leagueId}
        and i.league_season_id in (${inList(ids)}) and fts.franchise_id <> tts.franchise_id`)
  ).rows;
  if (items.length === 0) return empty();

  const values = await tradeValuations({ db, leagueId, seasonIds: ids, scope: "all" });
  const tradesOf = new Map<string, Set<number>>();
  const cell = (a: number, b: number) =>
    ((matrix[a] ??= {})[b] ??= { trades: 0, received: 0, sent: 0, net: 0 });
  for (const it of items) {
    const v = values.get(Number(it.item_id)) ?? 0;
    const to = Number(it.t);
    const from = Number(it.f);
    const gain = cell(to, from);
    gain.received += 1;
    gain.net += v;
    const loss = cell(from, to);
    loss.sent += 1;
    loss.net -= v;
    for (const key of [`${to}-${from}`, `${from}-${to}`]) {
      const set = tradesOf.get(key) ?? new Set<number>();
      set.add(Number(it.transaction_id));
      tradesOf.set(key, set);
    }
  }
  for (const [a, row] of Object.entries(matrix))
    for (const [b, c] of Object.entries(row)) {
      c.trades = tradesOf.get(`${a}-${b}`)?.size ?? 0;
      c.net = Math.round(c.net * 100) / 100;
    }
  const franchises = Object.keys(matrix)
    .map(Number)
    .sort((a, b) => a - b);
  return {
    franchises,
    matrix,
    entities: await franchiseEntities(db, franchises),
    seasonsIncluded: seasons.map((s) => s.year),
    availableFrom: seasons[0]?.year ?? null,
  };
}
