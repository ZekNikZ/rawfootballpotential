import { describe, expect, it } from "vitest";
import { scoringForSeason } from "../src/sleeper/points";

const sleeper = [
  { year: 2023, scoringSettings: { rec: 1, pass_td: 4 } },
  { year: 2022, scoringSettings: { rec: 1, pass_td: 6 } },
];

describe("scoringForSeason", () => {
  it("a Sleeper season uses its own settings", () => {
    expect(
      scoringForSeason(
        { id: 1, year: 2024, source: "sleeper", scoringSettings: { rec: 0.5 } },
        sleeper
      )
    ).toEqual({ rec: 0.5 });
  });

  it("an ESPN season uses the league's earliest Sleeper season", () => {
    expect(
      scoringForSeason({ id: 2, year: 2021, source: "espn", scoringSettings: {} }, sleeper)
    ).toEqual({
      rec: 1,
      pass_td: 6,
    });
  });

  it("an ESPN season that has settings of its own keeps them, and with no Sleeper season there is nothing", () => {
    expect(
      scoringForSeason({ id: 3, year: 2020, source: "espn", scoringSettings: { rec: 2 } }, sleeper)
    ).toEqual({ rec: 2 });
    expect(
      scoringForSeason({ id: 4, year: 2020, source: "espn", scoringSettings: {} }, [])
    ).toEqual({});
  });
});
