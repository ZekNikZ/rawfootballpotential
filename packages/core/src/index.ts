export const SLOT_KINDS = ["starter", "bench", "ir", "taxi"] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];
