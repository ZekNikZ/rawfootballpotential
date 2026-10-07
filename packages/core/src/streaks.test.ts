import { describe, expect, it } from "vitest";
import { buildGameResults, medianFilter, type Game } from "./results";
import { longestStreak, streakRuns, type StreakRow } from "./streaks";
import type { ResultValue } from "./types";

const rows = (season: number, results: string): StreakRow[] =>
  [...results].map((c, i) => ({ season, week: i + 1, seq: 1, result: c as ResultValue }));

describe("streakRuns", () => {
  it("finds runs of the target value", () => {
    expect(streakRuns([..."WWLWWW"] as ResultValue[], "W").map((r) => r.length)).toEqual([2, 3]);
  });

  it("a tie ends both a win streak and a loss streak (doc §2)", () => {
    expect(longestStreak(rows(1, "WWTWW"), "W").length).toBe(2);
    expect(longestStreak(rows(1, "LLTLL"), "L").length).toBe(2);
  });
});

describe("longestStreak", () => {
  it("is per season by default: a streak does not carry across a season boundary", () => {
    const all = [...rows(2023, "LLLW"), ...rows(2024, "LLLL")];
    const res = longestStreak(all, "L");
    expect(res).toEqual({ length: 4, seasons: [2024] });
    // 2023 ends in W, so chaining would give 4 anyway; use a boundary that would chain:
    const chain = [...rows(2023, "WWW"), ...rows(2024, "WW")];
    expect(longestStreak(chain, "W").length).toBe(3);
    expect(longestStreak(chain, "W", { acrossSeasons: true }).length).toBe(5);
  });

  it("lists every season that holds the record length", () => {
    const all = [...rows(2021, "LLLL"), ...rows(2022, "WLW"), ...rows(2023, "LLLL")];
    expect(longestStreak(all, "L")).toEqual({ length: 4, seasons: [2021, 2023] });
  });

  it("reports nothing when the target never happens", () => {
    expect(longestStreak(rows(2021, "WWW"), "L")).toEqual({ length: 0, seasons: [] });
  });

  it("orders games within a week by seq", () => {
    const r: StreakRow[] = [
      { season: 1, week: 1, seq: 2, result: "L" },
      { season: 1, week: 1, seq: 1, result: "W" },
      { season: 1, week: 2, seq: 1, result: "W" },
    ];
    // Ordered: W (h2h w1), L (median w1), W (h2h w2): longest W streak is 1.
    expect(longestStreak(r, "W").length).toBe(1);
  });

  // doc §1.4 bug 5
  it("'include medians' streaks see median results in (week, seq) order", () => {
    const g = (week: number, pa: number, pb: number): Game => ({
      matchupId: week,
      week,
      gameType: "regular",
      a: { teamSeasonId: 1, franchiseId: 1, points: pa },
      b: { teamSeasonId: 2, franchiseId: 2, points: pb },
    });
    const other = (week: number): Game => ({
      matchupId: 100 + week,
      week,
      gameType: "regular",
      a: { teamSeasonId: 3, franchiseId: 3, points: 150 },
      b: { teamSeasonId: 4, franchiseId: 4, points: 140 },
    });
    // Team 1 wins head to head every week, but weeks 2 and 3 are below the median (other game is high).
    const games = [g(1, 100, 50), g(2, 70, 60), other(2), g(3, 70, 60), other(3), g(4, 100, 50)];
    const t1 = buildGameResults(games).filter((r) => r.teamSeasonId === 1);
    const seq = (mode: Parameters<typeof medianFilter>[0]) =>
      t1
        .filter(medianFilter(mode, true))
        .map((r) => ({ season: 1, week: r.week, seq: r.seq, result: r.result }));
    const letters = (rows: StreakRow[]) => rows.map((r) => r.result).join("");

    expect(letters(seq("exclude"))).toBe("WWWW");
    expect(letters(seq("only"))).toBe("WLLW");
    expect(letters(seq("include"))).toBe("WWWLWLWW"); // week-by-week: h2h then median
    expect(longestStreak(seq("exclude"), "W").length).toBe(4);
    expect(longestStreak(seq("include"), "W").length).toBe(3); // median losses break it
    expect(longestStreak(seq("include"), "L").length).toBe(1);
    expect(longestStreak(seq("only"), "L").length).toBe(2);
  });
});
