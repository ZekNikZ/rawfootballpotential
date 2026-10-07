import { describe, expect, it } from "vitest";
import { asleepAtWheel, isDead, type WeekPlayer } from "./asleep";

const p = (
  id: string,
  slot: string,
  slotKind: WeekPlayer["slotKind"],
  position: string,
  points: number,
  extra: Partial<WeekPlayer> = {}
): WeekPlayer => ({
  id,
  slot,
  slotKind,
  position,
  points,
  onBye: false,
  nflStatus: "ACT",
  ...extra,
});

describe("isDead", () => {
  it("is a bye or any non-active roster status; unknown status counts as active", () => {
    expect(isDead({ onBye: true, nflStatus: null })).toBe(true);
    expect(isDead({ onBye: false, nflStatus: "INA" })).toBe(true);
    expect(isDead({ onBye: false, nflStatus: "res" })).toBe(true);
    expect(isDead({ onBye: false, nflStatus: "ACT" })).toBe(false);
    expect(isDead({ onBye: false, nflStatus: null })).toBe(false);
  });
});

describe("asleepAtWheel", () => {
  it("counts dead starters and prices the best live bench replacement", () => {
    const res = asleepAtWheel([
      p("q1", "QB", "starter", "QB", 20),
      p("r1", "RB", "starter", "RB", 0, { onBye: true, nflStatus: null }),
      p("w1", "WR", "starter", "WR", 0, { nflStatus: "INA" }),
      p("r2", "RB", "bench", "RB", 9),
      p("w2", "WR", "bench", "WR", 14),
      p("w3", "WR", "bench", "WR", 6),
    ]);
    expect(res.deadStarters).toBe(2);
    expect(res.byeStarters).toBe(1);
    expect(res.pointsLost).toBe(23); // RB r2 9 + WR w2 14
    expect(res.deadIds).toEqual(["r1", "w1"]);
  });

  it("never uses a dead or IR player as the replacement, and a slot nobody can fill loses nothing", () => {
    const res = asleepAtWheel([
      p("t1", "TE", "starter", "TE", 0, { onBye: true, nflStatus: null }),
      p("t2", "TE", "bench", "TE", 12, { nflStatus: "INA" }),
      p("t3", "TE", "ir", "TE", 11),
      p("w1", "WR", "bench", "WR", 30),
    ]);
    expect(res.deadStarters).toBe(1);
    expect(res.pointsLost).toBe(0);
  });

  it("lets a FLEX slot take any eligible bench position", () => {
    const res = asleepAtWheel([
      p("f1", "FLEX", "starter", "RB", 0, { onBye: true, nflStatus: null }),
      p("t1", "TE", "bench", "TE", 8),
    ]);
    expect(res.pointsLost).toBe(8);
  });

  it("is empty when every starter is live", () => {
    expect(asleepAtWheel([p("q1", "QB", "starter", "QB", 10)])).toEqual({
      deadStarters: 0,
      byeStarters: 0,
      pointsLost: 0,
      deadIds: [],
    });
  });
});
