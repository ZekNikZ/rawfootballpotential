/** Lineup display order: starters (by slot, QB first), then bench, IR, taxi. */
const SLOT_ORDER = [
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "REC_FLEX",
  "WRRB_FLEX",
  "SUPER_FLEX",
  "K",
  "DEF",
  "DL",
  "LB",
  "DB",
  "IDP_FLEX",
];
const KIND_ORDER = ["starter", "bench", "ir", "taxi"];

/** Sort key for a lineup entry; unknown slots sort after the known ones, in their own group. */
export function slotRank(slotKind: string, slot: string | null): number {
  const kind = KIND_ORDER.indexOf(slotKind);
  const within = slotKind === "starter" ? SLOT_ORDER.indexOf(slot ?? "") : 0;
  return (kind === -1 ? KIND_ORDER.length : kind) * 100 + (within === -1 ? 99 : within);
}

export const bySlot = <T extends { slotKind: string; slot: string | null; name: string }>(
  a: T,
  b: T
) => slotRank(a.slotKind, a.slot) - slotRank(b.slotKind, b.slot) || a.name.localeCompare(b.name);
