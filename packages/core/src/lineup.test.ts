import { describe, expect, it } from "vitest";
import { optimalLineup, type LineupPlayer } from "./lineup";

const p = (
  id: string,
  position: string,
  points: number,
  eligiblePositions?: string[]
): LineupPlayer => ({ id, position, points, eligiblePositions: eligiblePositions ?? null });

describe("optimalLineup", () => {
  it("fills fixed slots with the best player at each position", () => {
    const res = optimalLineup(
      ["QB", "RB", "WR"],
      [p("q1", "QB", 20), p("q2", "QB", 25), p("r1", "RB", 10), p("w1", "WR", 12)]
    );
    expect(res.points).toBe(47);
    expect(res.assignments.map((a) => a.playerId)).toEqual(["q2", "r1", "w1"]);
  });

  it("nests flex slots: the FLEX takes the best leftover RB/WR/TE", () => {
    const res = optimalLineup(
      ["RB", "WR", "FLEX"],
      [p("r1", "RB", 20), p("r2", "RB", 15), p("w1", "WR", 8), p("t1", "TE", 11)]
    );
    // RB r1, WR w1, FLEX best of r2 (15) / t1 (11)
    expect(res.points).toBe(43);
  });

  it("does not let a greedy early pick block a better global assignment", () => {
    // FLEX listed before RB: a naive in-order greedy gives the RB 20 to FLEX and leaves RB with 5.
    const res = optimalLineup(
      ["FLEX", "RB"],
      [p("r1", "RB", 20), p("r2", "RB", 5), p("t1", "TE", 12)]
    );
    expect(res.points).toBe(32); // RB r1 (20) + FLEX t1 (12)
  });

  it("SUPER_FLEX takes a second QB", () => {
    const res = optimalLineup(
      ["QB", "SUPER_FLEX"],
      [p("q1", "QB", 22), p("q2", "QB", 18), p("r1", "RB", 9)]
    );
    expect(res.points).toBe(40);
  });

  it("handles IDP slots and IDP_FLEX", () => {
    const res = optimalLineup(
      ["DL", "LB", "DB", "IDP_FLEX"],
      [p("d1", "DL", 9), p("d2", "DL", 7), p("l1", "LB", 11), p("b1", "DB", 4)]
    );
    expect(res.points).toBe(9 + 11 + 4 + 7);
  });

  // doc §1.4 bug 8
  it("uses the week's position snapshot, not today's position", () => {
    // Player was a WR that week (snapshot) even if he is a TE now: he must be able to fill WR but not TE.
    const wrThatWeek = p("x", "WR", 30);
    expect(optimalLineup(["WR"], [wrThatWeek]).points).toBe(30);
    expect(optimalLineup(["TE"], [wrThatWeek]).points).toBe(0);
  });

  // doc §1.4 bug 8
  it("honours multi-position eligibility (fantasy_positions snapshot)", () => {
    const hybrid = p("h", "LB", 14, ["LB", "DL"]);
    const res = optimalLineup(["DL", "LB"], [hybrid, p("l2", "LB", 6)]);
    // h must play DL (eligible) so l2 can fill LB: 14 + 6; a single-position reading gives only 14.
    expect(res.points).toBe(20);
  });

  it("leaves a slot empty when nobody can fill it", () => {
    const res = optimalLineup(["QB", "K"], [p("q1", "QB", 10)]);
    expect(res.points).toBe(10);
    expect(res.assignments[1]?.playerId).toBeNull();
  });

  it("starts a negative score rather than leaving a fillable slot empty", () => {
    expect(optimalLineup(["DEF"], [p("d", "DEF", -2)]).points).toBe(-2);
  });

  it("handles an empty slot list", () => {
    expect(optimalLineup([], [p("q1", "QB", 10)])).toEqual({ points: 0, assignments: [] });
  });
});
