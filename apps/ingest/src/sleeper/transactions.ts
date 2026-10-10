import { override, transaction, transactionItem, type Db } from "@rfp/db";
import { and, eq, inArray } from "@rfp/db";
import type { PlayerResolver } from "./players";
import type { SleeperTransaction } from "./schemas";

type TxType = (typeof transaction.$inferInsert)["type"];
type ItemInsert = typeof transactionItem.$inferInsert;

const TYPES = new Set<string>(["trade", "waiver", "free_agent", "commissioner"]);

const chunk = <T>(arr: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * Transaction corrections: an `override` row (entity 'transaction', field 'status', value 'reversed') keyed by the
 * Sleeper transaction id marks a transaction the commissioner reversed. It is stored like a failed claim, so no record
 * and no roster tenure counts it, and the Transactions page shows it with the reason.
 */
export const transactionOverrideKey = (leagueSeasonId: number, externalId: string) =>
  `ls:${leagueSeasonId}:x:${externalId}`;

export interface SyncTransactionsInput {
  leagueSeasonId: number;
  /** week -> transactions fetched for that week; weeks listed here are replaced. */
  byWeek: ReadonlyMap<number, readonly SleeperTransaction[]>;
  teamSeasonByRoster: ReadonlyMap<number, number>;
  franchiseByRoster: ReadonlyMap<number, number>;
  /** Sleeper user id -> roster id, to find the creating team. */
  rosterByOwner: ReadonlyMap<string, number>;
  players: PlayerResolver;
}

export interface TransactionStats {
  total: number;
  failed: number;
  byType: Record<string, number>;
  anomalies: string[];
}

export async function syncTransactions(
  db: Db,
  input: SyncTransactionsInput
): Promise<TransactionStats> {
  const stats: TransactionStats = { total: 0, failed: 0, byType: {}, anomalies: [] };
  const weeks = [...input.byWeek.keys()];
  if (weeks.length === 0) return stats;

  const all = [...input.byWeek.values()].flat();
  await input.players.resolve(
    all.flatMap((t) => [...Object.keys(t.adds ?? {}), ...Object.keys(t.drops ?? {})])
  );

  await db
    .delete(transaction)
    .where(
      and(eq(transaction.leagueSeasonId, input.leagueSeasonId), inArray(transaction.week, weeks))
    );

  const reversed = new Map<string, string>();
  for (const o of await db
    .select()
    .from(override)
    .where(
      and(
        eq(override.entity, "transaction"),
        eq(override.field, "status"),
        eq(override.active, true)
      )
    ))
    if (o.entityId.startsWith(`ls:${input.leagueSeasonId}:x:`))
      reversed.set(o.entityId.slice(`ls:${input.leagueSeasonId}:x:`.length), o.reason);

  const ts = (roster: number | undefined | null) =>
    roster === undefined || roster === null ? null : (input.teamSeasonByRoster.get(roster) ?? null);

  for (const batch of chunk(all, 500)) {
    const txRows: (typeof transaction.$inferInsert)[] = [];
    for (const t of batch) {
      if (!TYPES.has(t.type)) {
        stats.anomalies.push(`transaction ${t.transaction_id}: unknown type ${t.type}`);
        continue;
      }
      const reversal = reversed.get(t.transaction_id);
      const complete = t.status === "complete" && reversal === undefined;
      const creatorRoster = t.creator ? input.rosterByOwner.get(t.creator) : undefined;
      const when = t.status_updated ?? t.created;
      txRows.push({
        leagueSeasonId: input.leagueSeasonId,
        externalId: t.transaction_id,
        type: t.type as TxType,
        status: complete ? "complete" : "failed",
        // Rejected / canceled / pending trades are stored like failed claims and never counted.
        failureReason: complete
          ? null
          : reversal !== undefined
            ? `Reversed: ${reversal}`
            : ((typeof t.metadata?.notes === "string" ? t.metadata.notes : null) ?? t.status),
        week: t.leg,
        executedAt: when ? new Date(when) : null,
        creatorTeamSeasonId: ts(creatorRoster),
      });
      stats.total++;
      if (!complete) stats.failed++;
      stats.byType[t.type] = (stats.byType[t.type] ?? 0) + 1;
    }
    const inserted = await db
      .insert(transaction)
      .values(txRows)
      .returning({ id: transaction.id, ext: transaction.externalId });
    const idByExt = new Map(inserted.map((r) => [r.ext, r.id]));

    const items: ItemInsert[] = [];
    for (const t of batch) {
      const transactionId = idByExt.get(t.transaction_id);
      if (transactionId === undefined) continue;
      const adds = Object.entries(t.adds ?? {});
      const drops = new Map(Object.entries(t.drops ?? {}));
      const bid = typeof t.settings?.waiver_bid === "number" ? t.settings.waiver_bid : null;

      if (t.type === "trade") {
        for (const [pid, to] of adds) {
          const from = drops.get(pid);
          drops.delete(pid);
          items.push({
            transactionId,
            kind: "player",
            direction: "move",
            playerId: input.players.get(pid),
            fromTeamSeasonId: ts(from),
            toTeamSeasonId: ts(to),
          });
        }
        for (const p of t.draft_picks ?? []) {
          items.push({
            transactionId,
            kind: "pick",
            direction: "move",
            pickSeason: Number(p.season),
            pickRound: p.round,
            pickOriginalFranchiseId: input.franchiseByRoster.get(p.roster_id) ?? null,
            fromTeamSeasonId: ts(p.previous_owner_id),
            toTeamSeasonId: ts(p.owner_id),
          });
        }
        for (const b of t.waiver_budget ?? []) {
          items.push({
            transactionId,
            kind: "faab",
            direction: "move",
            amount: b.amount,
            fromTeamSeasonId: ts(b.sender),
            toTeamSeasonId: ts(b.receiver),
          });
        }
      } else {
        for (const [pid, to] of adds) {
          items.push({
            transactionId,
            kind: "player",
            direction: "add",
            playerId: input.players.get(pid),
            toTeamSeasonId: ts(to),
            faabBid: t.type === "waiver" ? bid : null,
          });
        }
      }
      for (const [pid, from] of drops) {
        items.push({
          transactionId,
          kind: "player",
          direction: "drop",
          playerId: input.players.get(pid),
          fromTeamSeasonId: ts(from),
        });
      }
    }
    for (const b of chunk(items, 2000)) if (b.length) await db.insert(transactionItem).values(b);
  }
  return stats;
}
