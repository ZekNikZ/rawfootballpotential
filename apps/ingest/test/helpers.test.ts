import { describe, expect, it } from "vitest";
import { canonicalTeam } from "../src/nfl/reference";
import { hashParams } from "../src/lib/raw-store";
import { scoreProjection } from "../src/sleeper/projections";
import { lastWeekOf, playoffRounds, weekStatuses } from "../src/sleeper/season";

describe("weekStatuses", () => {
  const clock = (season: number, week: number, seasonType: string) => ({
    season,
    week,
    seasonType,
  });

  it("an archived league or an earlier season is entirely complete", () => {
    expect([...weekStatuses(2024, 3, "complete", clock(2026, 4, "regular")).values()]).toEqual([
      "complete",
      "complete",
      "complete",
    ]);
    expect([...weekStatuses(2025, 3, "in_season", clock(2026, 4, "regular")).values()]).toEqual([
      "complete",
      "complete",
      "complete",
    ]);
  });

  it("the current season: weeks before /state/nfl's week are complete, that week is in progress", () => {
    const s = weekStatuses(2026, 5, "in_season", clock(2026, 3, "regular"));
    expect([...s.values()]).toEqual([
      "complete",
      "complete",
      "in_progress",
      "upcoming",
      "upcoming",
    ]);
  });

  it("pre-season is all upcoming; off-season is all complete; no clock is all upcoming", () => {
    expect(new Set(weekStatuses(2026, 4, "in_season", clock(2026, 1, "pre")).values())).toEqual(
      new Set(["upcoming"])
    );
    expect(new Set(weekStatuses(2026, 4, "in_season", clock(2026, 1, "off")).values())).toEqual(
      new Set(["complete"])
    );
    expect(new Set(weekStatuses(2026, 4, "in_season", null).values())).toEqual(
      new Set(["upcoming"])
    );
  });
});

describe("playoff length", () => {
  it("rounds = ceil(log2(playoff teams)); bracket rounds win when larger", () => {
    expect(playoffRounds(6)).toBe(3);
    expect(playoffRounds(7)).toBe(3);
    expect(playoffRounds(4)).toBe(2);
    const league = { settings: { playoff_week_start: 15, playoff_teams: 6 } } as Parameters<
      typeof lastWeekOf
    >[0];
    expect(lastWeekOf(league, null)).toBe(17);
    expect(lastWeekOf(league, [{ r: 4, m: 1 }])).toBe(18);
  });
});

describe("scoreProjection", () => {
  it("scores stat lines with the league's scoring settings and ignores non-scoring fields", () => {
    const stats = { pass_yd: 250, pass_td: 2, rush_yd: 20, adp_dd_ppr: 81, gp: 1, pts_ppr: 99 };
    const scoring = { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1 };
    expect(scoreProjection(stats, scoring)).toBe(20);
  });
});

describe("raw-store hashing and team aliases", () => {
  it("hashParams ignores key order", () => {
    expect(hashParams({ a: 1, b: { c: 2, d: 3 } })).toBe(hashParams({ b: { d: 3, c: 2 }, a: 1 }));
    expect(hashParams({ a: 1 })).not.toBe(hashParams({ a: 2 }));
  });

  it("maps legacy and Sleeper abbreviations onto nflverse's", () => {
    expect(canonicalTeam("LAR")).toBe("LA");
    expect(canonicalTeam("OAK")).toBe("LV");
    expect(canonicalTeam("SD")).toBe("LAC");
    expect(canonicalTeam("kc")).toBe("KC");
    expect(canonicalTeam(null)).toBeNull();
  });
});
