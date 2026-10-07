import { round3 } from "./points";
import type { Id } from "./types";

/**
 * Positions each lineup slot accepts. Slot names are the normalized names ingest adapters produce
 * (Sleeper's names are used as the canonical ones). Unknown slot names accept only the position of the same name.
 */
export const SLOT_ELIGIBILITY: Readonly<Record<string, readonly string[]>> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  DL: ["DL", "DE", "DT"],
  LB: ["LB"],
  DB: ["DB", "CB", "S"],
  IDP_FLEX: ["DL", "DE", "DT", "LB", "DB", "CB", "S"],
};

export interface LineupPlayer {
  id: Id;
  points: number;
  /** The player's position *that week* (player_week.position), not today's. */
  position: string | null;
  /** That week's multi-position eligibility (player_week.eligible_positions). */
  eligiblePositions?: readonly string[] | null;
}

export interface LineupAssignment {
  slot: string;
  slotIndex: number;
  playerId: Id | null;
}

export interface OptimalLineup {
  points: number;
  assignments: LineupAssignment[];
}

const FILL_BONUS = 1e7; // larger than any score range, so a fillable slot is always filled
const FORBIDDEN = 1e12;

export function slotAccepts(slot: string, player: LineupPlayer): boolean {
  const accepted = SLOT_ELIGIBILITY[slot] ?? [slot];
  const positions = new Set<string>(player.eligiblePositions ?? []);
  if (player.position) positions.add(player.position);
  return accepted.some((p) => positions.has(p));
}

/**
 * Best possible starting lineup from `players` for the given starter slots: the maximum-total
 * assignment of players to slots (exact, via the Hungarian algorithm), honouring flex nesting,
 * IDP slots and multi-position eligibility. Slots that no remaining player can fill stay empty.
 * Every fillable slot is filled, even by a negative score (a real lineup must start someone).
 */
export function optimalLineup(
  slots: readonly string[],
  players: readonly LineupPlayer[]
): OptimalLineup {
  const n = slots.length;
  const m = players.length + n; // + one "empty" column per slot
  const cost: number[][] = slots.map((slot) => {
    const row: number[] = [];
    for (const p of players) row.push(slotAccepts(slot, p) ? -(FILL_BONUS + p.points) : FORBIDDEN);
    for (let k = 0; k < n; k++) row.push(0);
    return row;
  });

  const cols = n === 0 ? [] : hungarian(cost, n, m);
  let total = 0;
  const assignments = slots.map((slot, slotIndex): LineupAssignment => {
    const col = cols[slotIndex] ?? -1;
    const player = col >= 0 && col < players.length ? players[col] : undefined;
    if (player) total += player.points;
    return { slot, slotIndex, playerId: player ? player.id : null };
  });
  return { points: round3(total), assignments };
}

/** Min-cost assignment of n rows to m >= n columns; returns the chosen column per row. O(n^2 m). */
function hungarian(cost: number[][], n: number, m: number): number[] {
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }
  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) result[p[j]! - 1] = j - 1;
  return result;
}
