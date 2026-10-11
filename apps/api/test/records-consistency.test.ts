import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorld, type World } from "./helpers";

// Schedule strength, score consistency, boom & bust and career all-play, checked against the hand-built fixture
// league (2030: 6 teams, regular weeks 1-3, playoffs weeks 4-5). Every expected value is worked out from the scores
// in fixture-league.ts; the arithmetic is in the comments.

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w?.close();
});

type Res = Awaited<ReturnType<World["run"]>>;
const names = (res: Res) => res.rows.map((r) => [r.rank, w.team(res, r)]);
const num = (res: Res, key: string) => res.rows.map((r) => Number(r.values[key]));

describe("strength of schedule", () => {
  it("season: opponents' scoring over the rest of their season, minus the league average", async () => {
    // League average 1755 / 18 = 97.5. Each game rates the opponent on its other two games, e.g. Team 4:
    // Team 3 without wk 1 (350-120)/2 = 115, Team 2 without wk 2 (280-95)/2 = 92.5, Team 1 without wk 3 (340-110)/2 = 115.
    const res = await w.run("season.sos", { seasons: "2030", minGames: 3 });
    expect(names(res)).toEqual([
      [1, "Team 4"],
      [2, "Team 2"],
      [3, "Team 1"],
      [4, "Team 3"],
      [5, "Team 5"],
      [6, "Team 6"],
    ]);
    const sos = num(res, "sos");
    [10, 7.5, 6.6667, 4.1667, -9.1667, -19.1667].forEach((v, i) =>
      expect(sos[i]).toBeCloseTo(v, 3)
    );
    expect(res.rows[0]?.values).toMatchObject({ record: "1-2", games: 3 });
    expect(Number(res.rows[0]?.values.oppAvg)).toBeCloseTo(107.5, 3);
  });

  it("career: the same figure over every game, one row per franchise", async () => {
    const res = await w.run("career.sos", { seasons: "2030", minGames: 3 });
    expect(res.rows.map((r) => w.team(res, r))).toEqual([
      "Team 4",
      "Team 2",
      "Team 1",
      "Team 3",
      "Team 5",
      "Team 6",
    ]);
  });

  it("leaves out teams below the minimum number of games", async () => {
    const res = await w.run("season.sos", { seasons: "2030" });
    expect(res.rows).toHaveLength(0);
  });
});

describe("score consistency", () => {
  it("season: sample standard deviation of the weekly scores", async () => {
    // Team 6: 110, 60, 95 (mean 88.33; squares 469.4 + 802.8 + 44.4 over 2 = 658.3, sd 25.658).
    // Team 3: 120, 90, 140 (sd 25.166). Team 2: 100, 95, 85 (sd 7.638, the steadiest).
    const res = await w.run("season.score.stddev", { seasons: "2030", minGames: 3 });
    expect(res.rows.map((r) => w.team(res, r))).toEqual([
      "Team 6",
      "Team 3",
      "Team 1",
      "Team 4",
      "Team 5",
      "Team 2",
    ]);
    const sd = num(res, "stddev");
    expect(sd[0]).toBeCloseTo(25.658, 3);
    expect(sd[1]).toBeCloseTo(25.1661, 3);
    expect(sd[5]).toBeCloseTo(7.6376, 3);
    expect(Number(res.rows[0]?.values.avg)).toBeCloseTo(88.3333, 3);
    expect(res.rows[0]?.values).toMatchObject({ high: 110, low: 60, games: 3 });
  });

  it("career: one season pools to that season's deviation", async () => {
    const res = await w.run("career.score.stddev", { seasons: "2030" });
    expect(Number(res.rows[0]?.values.stddev)).toBeCloseTo(25.658, 3);
    expect(w.team(res, res.rows[0]!)).toBe("Team 6");
  });
});

describe("boom and bust", () => {
  it("weeks above or below a team's own regular-season average", async () => {
    // Season averages: Team 3 116.67, Team 6 88.33, Team 1 113.33. Biggest booms: Team 3 wk 3 (140, +23.33),
    // Team 6 wk 1 (110, +21.67), Team 1 wk 2 (130, +16.67).
    const res = await w.run("boombust.week", { seasons: "2030", minGames: 3, limit: 3 });
    expect(res.rows.map((r) => [w.team(res, r), r.values.week])).toEqual([
      ["Team 3", 3],
      ["Team 6", 1],
      ["Team 1", 2],
    ]);
    expect(Number(res.rows[0]?.values.vsAvg)).toBeCloseTo(23.3333, 3);
  });

  it("the biggest bust is the lowest week against the team's own average", async () => {
    // Team 6 wk 2: 60 against 88.33 = -28.33.
    const res = await w.run("boombust.week", {
      seasons: "2030",
      minGames: 3,
      sort: "vsAvg",
      dir: "asc",
      limit: 1,
    });
    expect(w.team(res, res.rows[0]!)).toBe("Team 6");
    expect(Number(res.rows[0]?.values.vsAvg)).toBeCloseTo(-28.3333, 3);
  });

  it("career counts: a boom is one deviation above the season average, a bust one below", async () => {
    // Boom: Team 1 (130 vs 128.6 line), Team 5 (90 vs 88.7). Everyone else has exactly one bust:
    // Team 6 (60), Team 3 (90), Team 4 (80), Team 2 (85). Team 1 and Team 5 have none.
    const boom = await w.run("career.boom", { seasons: "2030", minGames: 3 });
    const top = boom.rows.filter((r) => r.rank === 1).map((r) => w.team(boom, r));
    expect(top.sort()).toEqual(["Team 1", "Team 5"]);
    expect(num(boom, "boom")).toEqual([1, 1, 0, 0, 0, 0]);
    const bust = await w.run("career.bust", { seasons: "2030", minGames: 3 });
    expect(bust.rows.filter((r) => r.rank === 1)).toHaveLength(4);
    expect(num(bust, "bust")).toEqual([1, 1, 1, 1, 0, 0]);
  });
});

describe("career all-play and luck", () => {
  it("all-play win % over the regular season", async () => {
    // Weekly all-play wins-losses (ties half): Team 3 5-0, 2-3, 5-0 = 12-3 (0.8); Team 1 2-2-1, 5-0, 4-1 = 11-3-1 (0.7667);
    // Team 4 7-8 (0.4667); Team 2 6-8-1 (0.4333); Team 6 6-9 (0.4); Team 5 2-13 (0.1333).
    const res = await w.run("career.allplay", { seasons: "2030" });
    expect(res.rows.map((r) => w.team(res, r))).toEqual([
      "Team 3",
      "Team 1",
      "Team 4",
      "Team 2",
      "Team 6",
      "Team 5",
    ]);
    const pct = num(res, "allPlayPct");
    [0.8, 0.7667, 0.4667, 0.4333, 0.4, 0.1333].forEach((v, i) => expect(pct[i]).toBeCloseTo(v, 3));
    expect(res.rows[0]?.values).toMatchObject({ allPlay: "12-3", record: "2-1" });
  });

  it("luck: actual wins minus the wins the all-play record predicts", async () => {
    // Team 6 won 2, expected 0.4 x 3 = 1.2 (+0.8); Team 5 1 vs 0.4 (+0.6); Team 1 2.5 vs 2.3 (+0.2);
    // Team 3 2 vs 2.4 and Team 4 1 vs 1.4 (-0.4 each, tied); Team 2 0.5 vs 1.3 (-0.8).
    const res = await w.run("career.luck", { seasons: "2030" });
    expect(res.rows.map((r) => [r.rank, w.team(res, r)]).slice(0, 3)).toEqual([
      [1, "Team 6"],
      [2, "Team 5"],
      [3, "Team 1"],
    ]);
    expect(num(res, "luck").map((v) => Math.round(v * 10) / 10)).toEqual([
      0.8, 0.6, 0.2, -0.4, -0.4, -0.8,
    ]);
    expect(res.rows[3]?.rank).toBe(4);
    expect(res.rows[4]?.rank).toBe(4);
    expect(res.rows[5]?.rank).toBe(6);
  });
});
