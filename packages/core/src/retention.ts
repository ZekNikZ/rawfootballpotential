import type { Tenure } from "./tenure";
import type { Id } from "./types";

export interface RetentionResult {
  total: number;
  kept: number;
  /** kept / total, or null when nothing was drafted. */
  pct: number | null;
}

/**
 * Drafted-player retention (doc §2): a drafted player counts as kept only if he is on the drafting team in the
 * final week of the season as one continuous stint from the draft. Traded or dropped = no, even when he was
 * re-acquired later (that later stint is not a draft stint). Pass the tenures of the drafting team season.
 */
export function draftRetention(
  draftedPlayerIds: readonly Id[],
  tenures: readonly Tenure[],
  finalWeek: number
): RetentionResult {
  const players = [...new Set(draftedPlayerIds)];
  const kept = players.filter((id) =>
    tenures.some((t) => t.playerId === id && t.acquiredVia === "draft" && t.toWeek >= finalWeek)
  ).length;
  return { total: players.length, kept, pct: players.length === 0 ? null : kept / players.length };
}
