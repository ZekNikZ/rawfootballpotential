import { describe, expect, it } from "vitest";
import { compareScores, winPct } from "./points";
import { median, weekStats } from "./stats";
import { buildGameResults, medianFilter, tally, type Game } from "./results";
import { pairWeek } from "./pairing";

const side = (id: number, points: number) => ({ teamSeasonId: id, franchiseId: id, points });
const game = (
  matchupId: number,
  week: number,
  a: number,
  pa: number,
  b: number,
  pb: number
): Game => ({
  matchupId,
  week,
  gameType: "regular",
  a: side(a, pa),
  b: side(b, pb),
});

describe("ties and win % (doc §2, §1.4 bug 2)", () => {
  it("equal scores are a tie, not a win for the second team", () => {
    expect(compareScores(100, 100)).toBe("T");
    expect(compareScores(100.0004, 100.0001)).toBe("T"); // equal at 3 dp
    expect(compareScores(100.01, 100)).toBe("W");
    expect(compareScores(99, 100)).toBe("L");
  });

  it("win % = (W + 0.5T) / games", () => {
    expect(winPct(5, 3, 2)).toBe(0.6);
    expect(winPct(0, 0, 0)).toBeNull();
    expect(winPct(0, 0, 2)).toBe(0.5);
  });

  it("a tied head-to-head game gives both teams T", () => {
    const rows = buildGameResults([game(1, 1, 1, 100, 2, 100)]).filter((r) => r.kind === "h2h");
    expect(rows.map((r) => r.result)).toEqual(["T", "T"]);
  });
});

describe("true median (doc §2)", () => {
  it("odd count: the middle score; even count: mean of the two middle scores", () => {
    expect(median([90, 110, 100])).toBe(100);
    expect(median([80, 90, 110, 120])).toBe(100);
    expect(median([])).toBeNull();
  });

  it("is independent of head-to-head results", () => {
    // Weak team A beats a weaker team B head to head but is still below the week's median.
    const games = [game(1, 1, 1, 60, 2, 50), game(2, 1, 3, 130, 4, 120)];
    const rows = buildGameResults(games);
    const med = rows.filter((r) => r.kind === "median");
    expect(med.every((r) => r.pointsAgainst === 90)).toBe(true); // median of 50,60,120,130
    expect(med.find((r) => r.teamSeasonId === 1)?.result).toBe("L");
    expect(rows.find((r) => r.teamSeasonId === 1 && r.kind === "h2h")?.result).toBe("W");
  });

  it("a score exactly equal to the median is a tie (§1.4 bug 2: the old code counted it as a win)", () => {
    // Odd team count in the week's score set: 3 scores, the middle one equals the median.
    const games = [game(1, 1, 1, 100, 2, 90), { ...game(2, 1, 3, 110, 4, 100), a: side(3, 110) }];
    // scores: 100, 90, 110, 100 -> median 100
    const rows = buildGameResults(games).filter((r) => r.kind === "median");
    expect(rows.find((r) => r.teamSeasonId === 1)?.result).toBe("T");
    expect(rows.find((r) => r.teamSeasonId === 4)?.result).toBe("T");
  });

  it("median games exist only in regular-season weeks", () => {
    const playoff: Game = { ...game(1, 15, 1, 100, 2, 90), gameType: "playoffs" };
    expect(buildGameResults([playoff]).filter((r) => r.kind === "median")).toHaveLength(0);
  });

  it("median filter modes", () => {
    const rows = buildGameResults([game(1, 1, 1, 100, 2, 90)]);
    const count = (mode: Parameters<typeof medianFilter>[0], enabled: boolean) =>
      rows.filter(medianFilter(mode, enabled)).length;
    expect(count("include", false)).toBe(4);
    expect(count("exclude", true)).toBe(2);
    expect(count("only", false)).toBe(2);
    expect(count("default", false)).toBe(2);
    expect(count("default", true)).toBe(4);
  });

  // doc §1.4 bug 1: "Postseason + Include medians" must not pick up regular-season median wins.
  it("median rows are all regular-season, so any postseason scope excludes them", () => {
    const rows = buildGameResults([
      game(1, 1, 1, 100, 2, 90),
      { ...game(2, 15, 1, 100, 2, 90), gameType: "playoffs" },
    ]);
    const postseason = rows.filter(
      (r) => r.gameType === "playoffs" || r.gameType === "toilet_bowl"
    );
    const t = tally(postseason.filter(medianFilter("include", true)));
    expect(t).toEqual({ w: 1, l: 1, t: 0 }); // only the playoff h2h game, no median wins
  });
});

describe("weekStats", () => {
  const stats = weekStats([
    { teamId: "a", points: 120 },
    { teamId: "b", points: 100 },
    { teamId: "c", points: 100 },
    { teamId: "d", points: 80 },
  ]);

  it("ranks with ties sharing a position (RANK())", () => {
    expect(stats.teams.map((t) => t.rank)).toEqual([1, 2, 2, 4]);
  });

  it("computes all-play with ties", () => {
    expect(stats.teams[1]?.allPlay).toEqual({ w: 1, l: 1, t: 1 });
    expect(stats.teams[0]?.allPlay).toEqual({ w: 3, l: 0, t: 0 });
  });

  it("z-scores use the week's population standard deviation", () => {
    expect(stats.mean).toBe(100);
    expect(stats.median).toBe(100);
    const sd = Math.sqrt((400 + 0 + 0 + 400) / 4);
    expect(stats.teams[0]?.zscore).toBeCloseTo(20 / sd);
    expect(
      weekStats([
        { teamId: 1, points: 50 },
        { teamId: 2, points: 50 },
      ]).teams[0]?.zscore
    ).toBe(0);
  });
});

// doc §1.4 bug 7
describe("pairing teams with no game", () => {
  it("never groups idle teams (null matchup id) into a fake game", () => {
    const res = pairWeek([
      { teamId: 1, matchupId: 1, points: 100 },
      { teamId: 2, matchupId: 1, points: 90 },
      { teamId: 3, matchupId: null, points: 120 },
      { teamId: 4, matchupId: null, points: 70 },
      { teamId: 5, matchupId: undefined, points: 60 },
    ]);
    expect(res.games).toHaveLength(1);
    expect(res.unpaired.map((e) => e.teamId)).toEqual([3, 4, 5]);
  });

  it("a lone matchup id is a bye, a group of three is reported and ignored", () => {
    const res = pairWeek([
      { teamId: 1, matchupId: 7, points: 1 },
      { teamId: 2, matchupId: 8, points: 1 },
      { teamId: 3, matchupId: 8, points: 1 },
      { teamId: 4, matchupId: 8, points: 1 },
    ]);
    expect(res.games).toHaveLength(0);
    expect(res.anomalies).toEqual([8]);
    expect(res.unpaired).toHaveLength(4);
  });
});
