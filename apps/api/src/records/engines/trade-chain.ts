export interface ChainItem {
  itemId: number;
  transactionId: number;
  sender: number | null;
  receiver: number | null;
  /** What the item is worth to the team that received it, before any chain. */
  direct: number;
  /** The item's weight when its sender splits the return of a later trade (what it had been worth to the sender). */
  weight: number;
  /** The same player's next trade out of the receiving team, within the same stint. */
  nextItemId: number | null;
}

/**
 * Chaining (pure): item id -> estimated value. A player the receiving team traded on is worth `direct` plus his
 * share of what that team received in the later trade. The share is proportional to `weight` among everything the
 * team sent in that trade; when none of it had any weight (a preseason flip), to what each item was worth to its
 * new team (`direct`); when that is zero too, equal. What was received is valued the same way, so a chain of trades
 * is followed to the end of the season.
 *
 * A trade is judged on these values (the receiver gains one, the sender loses it). Summed over a manager's trades
 * they would count the return of a re-trade twice, so career totals use `direct` only.
 */
export function chainValues(list: readonly ChainItem[]): Map<number, number> {
  return chainResolve(list).values;
}

/** How an item's value was extended by the later trade of the same player. */
export interface ChainLink {
  nextItemId: number;
  /** Share of what the team received in the later trade that this item is credited with (0 to 1). */
  share: number;
  /** Total value of everything the team received in the later trade. */
  returned: number;
}

/** `chainValues` plus, for every item that was traded on, the link that explains the added value. */
export function chainResolve(list: readonly ChainItem[]): {
  values: Map<number, number>;
  links: Map<number, ChainLink>;
} {
  const links = new Map<number, ChainLink>();
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
      const total = sent.reduce((s, o) => s + o.weight, 0);
      const totalDirect = sent.reduce((s, o) => s + o.direct, 0);
      const share =
        total > 0
          ? next.weight / total
          : totalDirect > 0
            ? next.direct / totalDirect
            : 1 / Math.max(sent.length, 1);
      const returned = tx
        .filter((o) => o.receiver === it.receiver)
        .reduce((s, o) => s + valueOf(o), 0);
      v += share * returned;
      links.set(it.itemId, { nextItemId: next.itemId, share, returned });
    }
    memo.set(it.itemId, v);
    return v;
  };
  for (const it of items.values()) valueOf(it);
  return { values: memo, links };
}
