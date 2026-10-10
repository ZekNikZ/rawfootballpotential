import { sql } from "@rfp/db";
import type { Db, SQL } from "@rfp/db";
import { seasonCond } from "../context";
import { pointsSince, stintEnd } from "./points-since";

export interface ChainItem {
  itemId: number;
  transactionId: number;
  sender: number | null;
  receiver: number | null;
  direct: number;
  /** Points the sender got from this player over the stint that ended with this trade (the player's share weight). */
  sentPoints: number;
  /** The same player's next trade out of the receiving team, within the same stint. */
  nextItemId: number | null;
}

/**
 * Estimated value of every player moved in the trades of the given seasons, in points, for the team that received him:
 *
 *   value = points he scored for that team from the trade to the end of the stint (starters in full, bench at
 *           `benchWeight`)
 *         + if that team traded him on within the stint: his share of what the team received in that later trade.
 *
 * His share is proportional to the points he had scored for the team, out of everything the team sent in that
 * trade (equal shares when none of it scored). What the team received is valued the same way, so a chain of trades
 * is followed to the end of the season. A player who is dropped ends the chain.
 *
 * A trade is judged on this value (the receiver gains it, the sender loses it). Summing it over a manager's trades
 * would count the return of a re-trade twice, so career totals use the direct points only.
 */
export async function tradeItemValues(
  db: Db,
  seasonIds: readonly number[],
  benchWeight: number,
  scope?: SQL
): Promise<Map<number, number>> {
  if (seasonIds.length === 0) return new Map();
  const rows = (
    await db.execute<Record<string, unknown>>(sql`
      select i.item_id, i.transaction_id, i.from_team_season_id as sender, i.to_team_season_id as receiver,
             ${pointsSince(sql`i.to_team_season_id`, sql`i.player_id`, sql`i.week`, benchWeight, scope)} as direct,
             (select coalesce(sum(case when pw.slot_kind = 'starter' then pw.points else ${benchWeight} * pw.points end), 0)
                from player_tenure t
                join rec_player_week pw on pw.team_season_id = t.team_season_id and pw.player_id = t.player_id
                 and pw.week between t.from_week and t.to_week and pw.counts and pw.points is not null
                 ${scope ? sql`and ${scope}` : sql``}
               where t.team_season_id = i.from_team_season_id and t.player_id = i.player_id
                 and t.to_week = i.week - 1 and t.left_via = 'trade') as sent_points,
             (select j.item_id from rec_transaction_item j
               where j.type = 'trade' and j.kind = 'player' and j.player_id = i.player_id
                 and j.league_season_id = i.league_season_id and j.from_team_season_id = i.to_team_season_id
                 and (j.week, coalesce(j.executed_at, 'epoch'::timestamptz), j.item_id)
                     > (i.week, coalesce(i.executed_at, 'epoch'::timestamptz), i.item_id)
                 and j.week <= coalesce(${stintEnd(sql`i.to_team_season_id`, sql`i.player_id`, sql`i.week`)}, i.week - 1) + 1
               order by j.week, j.executed_at, j.item_id limit 1) as next_item_id
      from rec_transaction_item i
      where i.type = 'trade' and i.kind = 'player' and i.player_id is not null
        and ${seasonCond(sql`i.league_season_id`, [...seasonIds])}`)
  ).rows;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return chainValues(
    rows.map((r) => ({
      itemId: Number(r.item_id),
      transactionId: Number(r.transaction_id),
      sender: num(r.sender),
      receiver: num(r.receiver),
      direct: Number(r.direct ?? 0),
      sentPoints: Number(r.sent_points ?? 0),
      nextItemId: num(r.next_item_id),
    }))
  );
}

/** The chaining itself (pure): item id -> estimated value. */
export function chainValues(list: readonly ChainItem[]): Map<number, number> {
  const items = new Map<number, ChainItem>();
  const byTx = new Map<number, ChainItem[]>();
  for (const it of list) {
    items.set(it.itemId, it);
    byTx.set(it.transactionId, [...(byTx.get(it.transactionId) ?? []), it]);
  }
  const memo = new Map<number, number>();
  const valueOf = (it: ChainItem): number => {
    const known = memo.get(it.itemId);
    if (known !== undefined) return known;
    memo.set(it.itemId, it.direct); // guards against a cycle; time only moves forward, so there should be none
    let v = it.direct;
    const next = it.nextItemId === null ? undefined : items.get(it.nextItemId);
    if (next && it.receiver !== null) {
      const tx = byTx.get(next.transactionId) ?? [];
      const sent = tx.filter((o) => o.sender === it.receiver);
      const total = sent.reduce((s, o) => s + o.sentPoints, 0);
      const share = total > 0 ? next.sentPoints / total : 1 / Math.max(sent.length, 1);
      const returned = tx
        .filter((o) => o.receiver === it.receiver)
        .reduce((s, o) => s + valueOf(o), 0);
      v += share * returned;
    }
    memo.set(it.itemId, v);
    return v;
  };
  for (const it of items.values()) valueOf(it);
  return memo;
}

/** The values as an inline `iv(item_id, v)` CTE for a record query. */
export function itemValuesCte(values: Map<number, number>): SQL {
  if (values.size === 0) return sql`iv(item_id, v) as (select null::int, null::float8 where false)`;
  const rows = [...values].map(
    ([id, v]) => sql`(${id}::int, ${Math.round(v * 1000) / 1000}::float8)`
  );
  return sql`iv(item_id, v) as (values ${sql.join(rows, sql`, `)})`;
}
