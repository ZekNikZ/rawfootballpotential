import { describe, expect, it } from "vitest";
import { overridesForWeek, rescoreEntries, scoringDelta } from "../src/sleeper/rescore";
import type { SleeperMatchupEntry } from "../src/sleeper/schemas";

const current = { pass_int: -2, pass_yd: 0.04 };
const rules = [{ stat: "pass_int", points: -1, toWeek: 13 }];

describe("as-played scoring", () => {
  it("applies a rule only inside its week range", () => {
    expect(overridesForWeek(rules, 1)).toEqual({ pass_int: -1 });
    expect(overridesForWeek(rules, 13)).toEqual({ pass_int: -1 });
    expect(overridesForWeek(rules, 14)).toEqual({});
    expect(overridesForWeek([{ stat: "rec", points: 0.5, fromWeek: 3 }], 2)).toEqual({});
    expect(overridesForWeek([{ stat: "rec", points: 0.5, fromWeek: 3 }], 9)).toEqual({ rec: 0.5 });
  });

  it("delta = units x (as-played - current); stats without the stat do not move", () => {
    expect(scoringDelta({ pass_int: 2, pass_yd: 300 }, current, { pass_int: -1 })).toBe(2);
    expect(scoringDelta({ pass_yd: 300 }, current, { pass_int: -1 })).toBe(0);
    expect(scoringDelta(undefined, current, { pass_int: -1 })).toBe(0);
    // a stat the league never scored (current 0) moves by its full as-played value
    expect(scoringDelta({ rec: 5 }, {}, { rec: 1 })).toBe(5);
  });

  const entry: SleeperMatchupEntry = {
    roster_id: 1,
    matchup_id: 1,
    points: 100,
    custom_points: null,
    starters: ["qb", "0", "rb"],
    starters_points: [20, 0, 10],
    players: ["qb", "rb", "bench"],
    players_points: { qb: 20, rb: 10, bench: 8 },
  };

  it("moves player, starter and team points together; bench players move but do not count toward the team", () => {
    const stats = { qb: { pass_int: 3 }, bench: { pass_int: 1 } };
    const [out] = rescoreEntries([entry], 5, stats, current, rules);
    expect(out?.players_points).toEqual({ qb: 23, rb: 10, bench: 9 });
    expect(out?.starters_points).toEqual([23, 0, 10]);
    expect(out?.points).toBe(103);
  });

  it("leaves weeks outside the rule untouched, and keeps a commissioner adjustment relative", () => {
    const stats = { qb: { pass_int: 3 } };
    expect(rescoreEntries([entry], 14, stats, current, rules)[0]?.points).toBe(100);
    const withCustom = { ...entry, custom_points: 125 };
    expect(rescoreEntries([withCustom], 5, stats, current, rules)[0]).toMatchObject({
      points: 103,
      custom_points: 128,
    });
  });
});
