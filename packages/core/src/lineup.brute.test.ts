import { describe, expect, it } from "vitest";
import { optimalLineup, slotAccepts, type LineupPlayer } from "./lineup";

/** Exhaustive best total over all ways to fill slots (each fillable slot filled, no player reused). */
function brute(slots: string[], players: LineupPlayer[]): number {
  let best = -Infinity;
  const used = new Set<number>();
  const go = (i: number, sum: number, filled: number) => {
    if (i === slots.length) {
      // prefer more filled slots, then more points (same rule as the optimizer)
      const score = filled * 1e7 + sum;
      if (score > best) best = score;
      return;
    }
    go(i + 1, sum, filled); // leave empty
    players.forEach((p, j) => {
      if (used.has(j) || !slotAccepts(slots[i]!, p)) return;
      used.add(j);
      go(i + 1, sum + p.points, filled + 1);
      used.delete(j);
    });
  };
  go(0, 0, 0);
  return best;
}

// Small deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

describe("optimalLineup vs brute force", () => {
  it("matches on random rosters with flex and IDP slots", () => {
    const rand = rng(42);
    const positions = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
    const slotPool = [
      "QB",
      "RB",
      "RB",
      "WR",
      "WR",
      "TE",
      "FLEX",
      "SUPER_FLEX",
      "K",
      "DEF",
      "DL",
      "LB",
      "IDP_FLEX",
      "REC_FLEX",
    ];
    for (let t = 0; t < 150; t++) {
      const slots = Array.from(
        { length: 3 + Math.floor(rand() * 4) },
        () => slotPool[Math.floor(rand() * slotPool.length)]!
      );
      const players: LineupPlayer[] = Array.from({ length: 4 + Math.floor(rand() * 5) }, (_, i) => {
        const pos = positions[Math.floor(rand() * positions.length)]!;
        const extra = rand() < 0.3 ? [positions[Math.floor(rand() * positions.length)]!] : [];
        return {
          id: i,
          position: pos,
          eligiblePositions: extra,
          points: Math.round((rand() * 40 - 5) * 100) / 100,
        };
      });
      const got = optimalLineup(slots, players);
      const filled = got.assignments.filter((a) => a.playerId !== null).length;
      expect(filled * 1e7 + got.points).toBeCloseTo(brute(slots, players), 3);
    }
  });
});
