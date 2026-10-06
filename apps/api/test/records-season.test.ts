import { leagueSeason, eq } from "@rfp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w?.close();
});

const seasonRows = (res: Awaited<ReturnType<World["run"]>>) =>
  res.rows.map((r) => `${r.rank}:${w.team(res, r)}:${r.values.season}:${r.values.value}`);

describe("season totals", () => {
  it("most points in a season (counted games only)", async () => {
    const res = await w.run("season.pf.high", { limit: 5 });
    expect(seasonRows(res)).toEqual([
      "1:Team 3:2030:605",
      "2:Team 1:2030:565",
      "3:Team 3:2031:550",
      "4:Team 1:2031:545",
      "5:Team 4:2031:535",
    ]);
    expect(res.rows[0]?.values).toMatchObject({ pf: 605, games: 5, record: "6-2" });
  });

  it("fewest points against; scope narrows PF to the postseason", async () => {
    const pa = await w.run("season.pa.low", { limit: 3 });
    // Team 6's opponent in 2030 was only ever Team 5 (90+70+75), because its week-4 game is outside the brackets.
    expect(seasonRows(pa)).toEqual(["1:Team 6:2030:235", "2:Team 6:2031:255", "3:Team 5:2030:265"]);
    const post = await w.run("season.pf.high", { scope: "postseason", limit: 3 });
    expect(seasonRows(post)).toEqual([
      "1:Team 3:2030:255",
      "2:Team 3:2031:230",
      "2:Team 4:2031:230",
    ]);
    expect(post.total).toBe(8); // the four playoff teams in each season; Teams 5 and 6 have no postseason games
  });

  it("wins and losses include medians by default (the seasons have the median on), with ties ranked together", async () => {
    const wins = await w.run("season.wins.high", { limit: 6 });
    expect(wins.rows.map((r) => [r.rank, r.values.wins])).toEqual([
      [1, 6],
      [1, 6],
      [1, 6],
      [4, 5],
      [4, 5],
      [6, 3],
    ]);
    const exclude = await w.run("season.wins.high", { median: "exclude", limit: 3 });
    expect(exclude.rows[0]?.values.wins).toBe(4); // head-to-head only: Team 3 in 2030 and Team 4 in 2031 win 4 of 5
    const only = await w.run("season.wins.high", { median: "only", limit: 2 });
    expect(only.rows[0]?.values.wins).toBe(3);
    const losses = await w.run("season.losses.high", { limit: 3 });
    expect(seasonRows(losses)).toEqual(["1:Team 2:2031:8", "2:Team 4:2030:5", "2:Team 5:2030:5"]);
  });

  it("win % has a minimum-games qualifier that is enforced and reported (doc §3.3)", async () => {
    const strict = await w.run("season.winpct.high");
    expect(strict.meta.qualifier).toEqual({ minGames: 10 });
    expect(strict.total).toBe(0); // nobody plays 10 games in a 6-team, 5-week fixture
    const relaxed = await w.run("season.winpct.high", { minGames: 1, limit: 5 });
    expect(relaxed.rows.map((r) => [r.rank, r.values.winPct])).toEqual([
      [1, 0.75],
      [1, 0.75],
      [1, 0.75],
      [1, 0.75],
      [5, 0.625],
    ]);
    const low = await w.run("season.winpct.low", { minGames: 1, limit: 1 });
    expect(low.rows[0]?.values.winPct).toBe(0);
  });

  it("a tie counts half a win in win % (doc §2)", async () => {
    // Team 1 in 2030: 5 wins, 1 loss, 2 ties over 8 games = (5 + 1) / 8
    const res = await w.run("season.wins.high", { limit: 20 });
    const row = res.rows.find((r) => w.team(res, r) === "Team 1" && r.values.season === 2030)!;
    expect(row.values).toMatchObject({
      wins: 5,
      losses: 1,
      ties: 2,
      winPct: 0.75,
      record: "5-1-2",
    });
  });

  it("lineup IQ is points over potential, per season, with player data only", async () => {
    const res = await w.run("season.iq.high", { minGames: 1, limit: 3 });
    // Every counted odd week misses exactly 7 points, so a team with fewer odd weeks has the higher IQ.
    expect(res.rows[0]?.values.lineupIq).toBeGreaterThan(0.95);
    expect(res.meta.requires).toContain("playerData");
  });
});

describe("active-season policy (doc §3.3)", () => {
  it("complete_only leaves an in-progress season out; flag keeps it and marks the rows", async () => {
    await w.db
      .update(leagueSeason)
      .set({ status: "in_season" })
      .where(eq(leagueSeason.id, w.fixture.seasonIds[2031]!));
    try {
      const low = await w.run("season.pf.low", { limit: 50 });
      expect(low.seasonsIncluded).toEqual([2030]);
      expect(low.rows.every((r) => r.values.season === 2030)).toBe(true);
      const high = await w.run("season.pf.high", { limit: 50 });
      expect(high.seasonsIncluded).toEqual([2030, 2031]);
      expect(high.rows.filter((r) => r.inProgress).every((r) => r.values.season === 2031)).toBe(
        true
      );
      expect(high.rows.some((r) => r.inProgress)).toBe(true);
      // single-week records just include it
      expect((await w.run("score.low", { limit: 1 })).seasonsIncluded).toEqual([2030, 2031]);
    } finally {
      await w.db
        .update(leagueSeason)
        .set({ status: "complete" })
        .where(eq(leagueSeason.id, w.fixture.seasonIds[2031]!));
    }
  });

  it("requirements are checked against each season's data flags and reported", async () => {
    const res = await w.run("waiver.faab-high");
    expect(res.availableFrom).toBe(2030);
    const none = await w.run("draft.price-high");
    expect(none.availableFrom).toBeNull(); // snake drafts only
    expect(none.rows).toEqual([]);
  });
});

describe("potential, teamwide and bench (player data)", () => {
  it("potential = actual + the bench points a better lineup would have added", async () => {
    const res = await w.run("potential.high", { limit: 1 });
    expect(res.rows[0]?.values).toMatchObject({ potential: 147, points: 140, ratio: 0.952 });
    const teamwide = await w.run("teamwide.high", { limit: 1 });
    expect(teamwide.rows[0]?.values).toMatchObject({ teamwide: 175, points: 140, bench: 35 });
    const bench = await w.run("bench.high", { limit: 3 });
    expect(bench.rows.map((r) => [r.rank, r.values.value])).toEqual([
      [1, 35],
      [2, 33],
      [3, 32],
    ]);
  });

  it("realized ratio: every even-week lineup is perfect and ties at the top", async () => {
    const res = await w.run("ratio.high", { limit: 60 });
    expect(res.rows.filter((r) => r.rank === 1).length).toBe(20);
    const low = await w.run("ratio.low", { limit: 1 });
    expect(low.rows[0]?.values).toMatchObject({ points: 60, season: 2031, week: 3 });
  });
});
