import type { Id } from "./types";

export interface TxItem {
  kind: "player" | "pick" | "faab";
  direction: "add" | "drop" | "move";
  playerId?: Id | null;
  fromTeam?: Id | null;
  toTeam?: Id | null;
  /** FAAB dollars moved (kind = 'faab'). */
  amount?: number | null;
  /** Winning bid on a waiver add. */
  faabBid?: number | null;
}

export type TxType = "trade" | "waiver" | "free_agent" | "commissioner";

export interface Tx {
  id: Id;
  type: TxType;
  status: "complete" | "failed";
  week: number;
  items: readonly TxItem[];
}

/**
 * Most-moved counting (doc §2): the number of distinct completed transactions that involve each player.
 * A trade = 1, a drop = 1, another team adding him = 1 more (dropped by A, claimed by B, traded to C = 3).
 * Failed claims never count.
 */
export function movesPerPlayer(txs: readonly Tx[]): Map<Id, number> {
  const counts = new Map<Id, number>();
  for (const tx of txs) {
    if (tx.status !== "complete") continue;
    const players = new Set<Id>();
    for (const item of tx.items)
      if (item.kind === "player" && item.playerId != null) players.add(item.playerId);
    for (const p of players) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return counts;
}

export interface TradeSize {
  /** Distinct players moved: the "largest trade" measure. Picks and FAAB don't count. */
  players: number;
  /** Distinct teams involved: the "broadest trade" measure. */
  teams: number;
  picks: number;
  /** FAAB dollars moved, shown as an extra column. */
  faab: number;
}

export function tradeSize(tx: Tx): TradeSize {
  const players = new Set<Id>();
  const teams = new Set<Id>();
  let picks = 0;
  let faab = 0;
  for (const item of tx.items) {
    if (item.fromTeam != null) teams.add(item.fromTeam);
    if (item.toTeam != null) teams.add(item.toTeam);
    if (item.kind === "player" && item.playerId != null) players.add(item.playerId);
    else if (item.kind === "pick") picks++;
    else if (item.kind === "faab") faab += item.amount ?? 0;
  }
  return { players: players.size, teams: teams.size, picks, faab };
}

export interface TeamTxCount {
  count: number;
  /** Winning FAAB bids ("$ spent"). */
  spent: number;
}

/**
 * Per-team transaction counts for a set of transaction types. Which types count is a property of each record
 * (`["waiver"]` or `["waiver", "free_agent"]`), never a user filter. Only successful transactions count.
 * Trades count once for every team that took part; claims count for the team that added the player(s).
 */
export function countByTeam(txs: readonly Tx[], txTypes: readonly TxType[]): Map<Id, TeamTxCount> {
  const out = new Map<Id, TeamTxCount>();
  const bump = (team: Id, spent: number) => {
    const cur = out.get(team) ?? { count: 0, spent: 0 };
    cur.count += 1;
    cur.spent += spent;
    out.set(team, cur);
  };
  for (const tx of txs) {
    if (tx.status !== "complete" || !txTypes.includes(tx.type)) continue;
    if (tx.type === "trade") {
      const teams = new Set<Id>();
      for (const i of tx.items) {
        if (i.fromTeam != null) teams.add(i.fromTeam);
        if (i.toTeam != null) teams.add(i.toTeam);
      }
      for (const t of teams) bump(t, 0);
      continue;
    }
    const spentByTeam = new Map<Id, number>();
    for (const i of tx.items) {
      if (i.direction === "add" && i.toTeam != null) {
        spentByTeam.set(i.toTeam, (spentByTeam.get(i.toTeam) ?? 0) + (i.faabBid ?? 0));
      }
    }
    for (const [team, spent] of spentByTeam) bump(team, spent);
  }
  return out;
}
