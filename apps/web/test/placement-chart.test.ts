import { describe, expect, it } from "vitest";
import { seriesColor, splitRuns, weightedPlacement } from "../src/lib/placement-chart";

const p = (season: number, place = 1, teamCount = 10) => ({ season, place, teamCount });

describe("placement chart helpers", () => {
  it("weights a place by league size", () => {
    expect(weightedPlacement(1, 14)).toBe(1);
    expect(weightedPlacement(14, 14)).toBe(0);
    expect(weightedPlacement(2, 14)).toBeGreaterThan(weightedPlacement(2, 9));
    expect(weightedPlacement(1, 1)).toBe(1);
  });

  it("splits a franchise into runs of consecutive seasons", () => {
    const seasons = [2020, 2021, 2022, 2023, 2024];
    expect(splitRuns([p(2020), p(2021), p(2023), p(2024)], seasons).map((r) => r.length)).toEqual([
      2, 2,
    ]);
    expect(splitRuns([p(2022), p(2020), p(2021)], seasons)[0]!.map((x) => x.season)).toEqual([
      2020, 2021, 2022,
    ]);
    expect(splitRuns([p(2024)], seasons)).toHaveLength(1);
    expect(splitRuns([], seasons)).toEqual([]);
  });

  it("gives neighbouring series different colours", () => {
    expect(seriesColor(0)).not.toBe(seriesColor(1));
  });
});
