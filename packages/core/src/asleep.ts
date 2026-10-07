import { optimalLineup, type LineupPlayer } from "./lineup";
import { round3 } from "./points";
import type { Id } from "./types";

/** One rostered player in one team-week, with what the NFL reference data says about his week. */
export interface WeekPlayer extends LineupPlayer {
  slot: string;
  slotKind: "starter" | "bench" | "ir" | "taxi";
  /** The player's NFL team had no game that week. */
  onBye: boolean;
  /** nflverse roster status (ACT, INA, RES, ...); null = unknown, treated as active. */
  nflStatus: string | null;
}

/** A starter who could not score: his team was on bye, or he was not active for the week. */
export function isDead(p: Pick<WeekPlayer, "onBye" | "nflStatus">): boolean {
  return p.onBye || (p.nflStatus !== null && p.nflStatus.toUpperCase() !== "ACT");
}

export interface AsleepResult {
  /** Starters on a bye or inactive. */
  deadStarters: number;
  /** Of those, starters whose NFL team was on bye. */
  byeStarters: number;
  /**
   * Points left on the table: what the best live bench players eligible for the dead slots would have scored
   * (live starters stay where they are). Never negative.
   */
  pointsLost: number;
  /** Ids of the dead starters. */
  deadIds: Id[];
}

/** "Asleep at the wheel" for one team-week (doc 4.5, NFL reference data). */
export function asleepAtWheel(players: readonly WeekPlayer[]): AsleepResult {
  const dead = players.filter((p) => p.slotKind === "starter" && isDead(p));
  if (dead.length === 0) return { deadStarters: 0, byeStarters: 0, pointsLost: 0, deadIds: [] };
  const bench = players.filter((p) => p.slotKind === "bench" && !isDead(p));
  const replacement = optimalLineup(
    dead.map((p) => p.slot),
    bench
  ).points;
  const scored = dead.reduce((sum, p) => sum + p.points, 0);
  return {
    deadStarters: dead.length,
    byeStarters: dead.filter((p) => p.onBye).length,
    pointsLost: round3(Math.max(0, replacement - scored)),
    deadIds: dead.map((p) => p.id),
  };
}
