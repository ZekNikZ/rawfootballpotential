import type { Id } from "./types";

export interface WeekEntry {
  teamId: Id;
  /** Source matchup id for the week; null/undefined when the team has no game (bye, eliminated, ...). */
  matchupId: Id | null | undefined;
  points: number;
}

export interface PairedWeek {
  games: [WeekEntry, WeekEntry][];
  /** Teams with no game that week. Their score is kept, but it never counts. */
  unpaired: WeekEntry[];
  /** Matchup ids shared by more than two teams: ignored, reported so ingest can log them. */
  anomalies: Id[];
}

/**
 * Pair one week's team entries into games. Only a matchup id shared by exactly two teams is a game;
 * entries without an id are never grouped together (doc §1.4 bug 7: a null id must not create a fake game
 * between idle teams).
 */
export function pairWeek(entries: readonly WeekEntry[]): PairedWeek {
  const groups = new Map<Id, WeekEntry[]>();
  const unpaired: WeekEntry[] = [];
  for (const e of entries) {
    if (e.matchupId === null || e.matchupId === undefined) {
      unpaired.push(e);
      continue;
    }
    const g = groups.get(e.matchupId);
    if (g) g.push(e);
    else groups.set(e.matchupId, [e]);
  }
  const games: [WeekEntry, WeekEntry][] = [];
  const anomalies: Id[] = [];
  for (const [id, g] of groups) {
    if (g.length === 2) games.push([g[0]!, g[1]!]);
    else {
      unpaired.push(...g);
      if (g.length > 2) anomalies.push(id);
    }
  }
  return { games, unpaired, anomalies };
}
