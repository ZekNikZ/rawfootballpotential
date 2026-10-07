import { draft, draftPick, tradedPick, type Db } from "@rfp/db";
import { and, eq } from "@rfp/db";
import type { PlayerResolver } from "./players";
import type { SleeperDraft, SleeperDraftPick, SleeperRoster, SleeperTradedPick } from "./schemas";

const chunk = <T>(arr: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export interface SyncDraftsInput {
  leagueSeasonId: number;
  leagueType: "redraft" | "dynasty";
  hasPreviousSeason: boolean;
  drafts: readonly { draft: SleeperDraft; picks: readonly SleeperDraftPick[] }[];
  rosters: readonly SleeperRoster[];
  teamSeasonByRoster: ReadonlyMap<number, number>;
  players: PlayerResolver;
}

export interface DraftStats {
  drafts: number;
  picks: number;
  hasAuction: boolean;
}

export async function syncDrafts(db: Db, input: SyncDraftsInput): Promise<DraftStats> {
  const stats: DraftStats = { drafts: 0, picks: 0, hasAuction: false };
  await input.players.resolve(
    input.drafts.flatMap((d) => d.picks.flatMap((p) => (p.player_id ? [p.player_id] : [])))
  );
  const rosterByOwner = new Map(
    input.rosters.flatMap((r) => (r.owner_id ? [[r.owner_id, r.roster_id] as const] : []))
  );

  for (const { draft: d, picks } of input.drafts) {
    const type = d.type === "auction" ? "auction" : d.type === "linear" ? "linear" : "snake";
    if (type === "auction") stats.hasAuction = true;
    const status =
      d.status === "complete" ? "complete" : d.status === "pre_draft" ? "pre_draft" : "drafting";
    const kind =
      input.leagueType === "redraft" ? "redraft" : input.hasPreviousSeason ? "rookie" : "startup";
    // slot -> roster: Sleeper's slot_to_roster_id, else derived from draft_order (user -> slot) and roster owners.
    const slotToRoster = new Map<number, number>();
    for (const [slot, roster] of Object.entries(d.slot_to_roster_id ?? {}))
      slotToRoster.set(Number(slot), roster);
    if (slotToRoster.size === 0) {
      for (const [user, slot] of Object.entries(d.draft_order ?? {})) {
        const roster = rosterByOwner.get(user);
        if (roster !== undefined) slotToRoster.set(slot, roster);
      }
    }
    const slotOrder: Record<string, number> = {};
    for (const [slot, roster] of slotToRoster) {
      const ts = input.teamSeasonByRoster.get(roster);
      if (ts !== undefined) slotOrder[String(slot)] = ts;
    }
    const rounds = typeof d.settings?.rounds === "number" ? d.settings.rounds : null;
    const values = {
      leagueSeasonId: input.leagueSeasonId,
      externalId: d.draft_id,
      kind: kind as "startup" | "rookie" | "redraft",
      type: type as "snake" | "auction" | "linear",
      status: status as "pre_draft" | "drafting" | "complete",
      rounds,
      startedAt: d.start_time ? new Date(d.start_time) : null,
      slotOrder,
    };
    const [row] = await db
      .insert(draft)
      .values(values)
      .onConflictDoUpdate({ target: [draft.leagueSeasonId, draft.externalId], set: values })
      .returning({ id: draft.id });
    const draftId = row!.id;
    await db.delete(draftPick).where(eq(draftPick.draftId, draftId));

    const pickRows: (typeof draftPick.$inferInsert)[] = [];
    for (const p of picks) {
      const teamSeasonId =
        p.roster_id != null ? input.teamSeasonByRoster.get(p.roster_id) : undefined;
      if (teamSeasonId === undefined) continue;
      const original = p.draft_slot != null ? slotToRoster.get(p.draft_slot) : undefined;
      const amount = Number(p.metadata?.amount);
      pickRows.push({
        draftId,
        pickNo: p.pick_no,
        round: p.round,
        slot: p.draft_slot ?? null,
        teamSeasonId,
        originalTeamSeasonId:
          original !== undefined ? (input.teamSeasonByRoster.get(original) ?? null) : null,
        playerId: p.player_id ? input.players.get(p.player_id) : null,
        amount: type === "auction" && Number.isFinite(amount) ? amount : null,
        isKeeper: p.is_keeper ?? false,
      });
    }
    for (const b of chunk(pickRows, 1000)) if (b.length) await db.insert(draftPick).values(b);
    stats.drafts++;
    stats.picks += pickRows.length;
  }
  return stats;
}

/** Future picks for a league (dynasty): who currently owns each pick. Replaces the league's rows. */
export async function syncTradedPicks(
  db: Db,
  leagueId: number,
  picks: readonly SleeperTradedPick[],
  franchiseByRoster: ReadonlyMap<number, number>
): Promise<number> {
  const rows: (typeof tradedPick.$inferInsert)[] = [];
  for (const p of picks) {
    const original = franchiseByRoster.get(p.roster_id);
    const owner = franchiseByRoster.get(p.owner_id);
    if (original === undefined || owner === undefined) continue;
    rows.push({
      leagueId,
      season: Number(p.season),
      round: p.round,
      originalFranchiseId: original,
      ownerFranchiseId: owner,
    });
  }
  await db.delete(tradedPick).where(and(eq(tradedPick.leagueId, leagueId)));
  for (const b of chunk(rows, 1000)) if (b.length) await db.insert(tradedPick).values(b);
  return rows.length;
}
