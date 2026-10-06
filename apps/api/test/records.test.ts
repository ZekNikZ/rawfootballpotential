import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorld, type World } from "./helpers";

// Expected values below are worked out by hand from the fixture leagues in
// apps/ingest/src/testing/fixture-league.ts (2030 and 2031 seasons, 6 teams, median on).

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w?.close();
});

describe("single-week team records", () => {
  it("highest score: RANK() gives ties the same position and skips the next ones", async () => {
    const res = await w.run("score.high", { limit: 12 });
    const ranks = res.rows.map((r) => r.rank);
    expect(ranks).toEqual([1, 2, 2, 2, 2, 6, 6, 8, 8, 8, 8, 12]);
    expect(res.rows[0]?.values.value).toBe(140);
    expect(w.team(res, res.rows[0]!)).toBe("Team 3");
    expect(res.rows[0]?.values).toMatchObject({
      season: 2030,
      week: 3,
      points: 140,
      opponentPoints: 85,
      margin: 55,
    });
    expect(res.total).toBe(26 + 26); // counted team-weeks over both seasons
  });

  it("lowest score ignores uncounted weeks (a bye, an idle team, a game outside the brackets)", async () => {
    const res = await w.run("score.low", { limit: 6 });
    // 60 three times (Team 6 in 2030 wk2, Team 6 in 2031 wk2, Team 2 in 2031 wk3), then 70 twice. The 55 and 65
    // scores from idle teams in week 5 and the none-game scores in week 4 never appear.
    expect(res.rows.map((r) => [r.rank, r.values.value])).toEqual([
      [1, 60],
      [1, 60],
      [1, 60],
      [4, 70],
      [4, 70],
      [6, 75],
    ]);
  });

  it("winner-side records exclude tied games (doc §1.4 bug 2)", async () => {
    const narrow = await w.run("narrow-win", { limit: 5 });
    // The 100-100 tie in 2030 week 1 has margin 0 but is not a win, so it is not the narrowest win.
    expect(narrow.rows.map((r) => [r.rank, r.values.value])).toEqual([
      [1, 5],
      [1, 5],
      [1, 5],
      [4, 10],
      [4, 10],
    ]);
    const blowout = await w.run("blowout", { limit: 4 });
    expect(blowout.rows.map((r) => [r.rank, r.values.value])).toEqual([
      [1, 65],
      [2, 55],
      [3, 40],
      [3, 40],
    ]);
    expect(w.team(blowout, blowout.rows[0]!)).toBe("Team 3");
  });

  it("highest scoring loss / lowest scoring win", async () => {
    const loss = await w.run("loss.high-score", { limit: 4 });
    expect(loss.rows.map((r) => [r.rank, r.values.value])).toEqual([
      [1, 110],
      [1, 110],
      [3, 105],
      [3, 105],
    ]);
    const win = await w.run("win.low-score", { limit: 5 });
    expect(win.rows.map((r) => [r.rank, r.values.value])).toEqual([
      [1, 70],
      [2, 85],
      [3, 90],
      [4, 95],
      [4, 95],
    ]);
  });

  it("scope follows the bracket: playoffs, toilet bowl, postseason and regular", async () => {
    const playoffs = await w.run("score.high", { scope: "playoffs", limit: 3 });
    expect(playoffs.rows.map((r) => [r.rank, r.values.value])).toEqual([
      [1, 130],
      [1, 130],
      [3, 125],
    ]);
    expect(playoffs.total).toBe(16); // 4 games x 2 sides x 2 seasons: the unbracketed week-4 game is not a playoff game
    expect((await w.run("score.high", { scope: "postseason" })).total).toBe(16);
    expect((await w.run("score.high", { scope: "toilet_bowl" })).total).toBe(0);
    const regular = await w.run("score.high", { scope: "regular", limit: 1 });
    expect(regular.rows[0]?.values.value).toBe(140);
    expect(regular.total).toBe(36);
  });

  it("weeks, franchise and opponent filters", async () => {
    expect((await w.run("score.high", { weeks: "4-5" })).total).toBe(16);
    const all = await w.run("score.high", { limit: 60 });
    const franchise1 = all.rows.find((r) => w.team(all, r) === "Team 1")!.refs.franchiseId;
    const team1 = await w.run("score.high", { franchise: franchise1, limit: 50 });
    expect(team1.rows.every((r) => w.team(team1, r) === "Team 1")).toBe(true);
    expect(team1.total).toBe(10);
  });

  it("onePer: season keeps only the best row of each season", async () => {
    const res = await w.run("score.high", { onePer: "season" });
    expect(res.rows.map((r) => [r.rank, r.values.season, r.values.value])).toEqual([
      [1, 2030, 140],
      [2, 2031, 130],
    ]);
  });
});
