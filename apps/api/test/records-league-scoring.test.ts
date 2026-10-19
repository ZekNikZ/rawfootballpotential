import { and, eq, leagueSeason, matchup } from "@rfp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorld, type World } from "./helpers";

// League-wide scoring records, checked against the hand-built fixture leagues (see fixture-league.ts). Both seasons:
// 6 teams, regular weeks 1-3 (all six play), playoff weeks 4-5 (teams 1-4 only; teams 5 and 6 play a game outside
// the brackets in week 4 and idle in week 5, so those scores never count). A team's bench player scores nothing on
// even weeks and (0.2 x the team's score) + 7 on odd weeks, and its teamwide score is its score plus its bench.
//
//   regular-season scores   2030: wk1 600, wk2 550, wk3 605   (total 1755 over 18 team-games)
//                           2031: wk1 605, wk2 530, wk3 580   (total 1715)
//   playoff scores          2030: wk4 460, wk5 415   (875 over 8 games)
//                           2031: wk4 415, wk5 435   (850)

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w?.close();
});

type Res = Awaited<ReturnType<World["run"]>>;
const seasons = (res: Res, ...keys: string[]) =>
  res.rows.map((r) => [r.rank, r.values.season, ...keys.map((k) => r.values[k])]);
const weeks = (res: Res, ...keys: string[]) =>
  res.rows.map((r) => [r.rank, r.values.season, r.values.week, ...keys.map((k) => r.values[k])]);

describe("league scoring by season", () => {
  it("counted points: the season total, the per-team-game average, and what was added up", async () => {
    const total = await w.run("league.season.counted.total");
    // The scope switcher defaults to the regular season.
    expect(total.params.scope).toBe("regular");
    expect(seasons(total, "total", "avg", "games", "teams", "weeks")).toEqual([
      [1, 2030, 1755, 97.5, 18, 6, 3],
      [2, 2031, 1715, 95.278, 18, 6, 3],
    ]);
    // Same data, ranked by the average: 1715 / 18 = 95.2778.
    const avg = await w.run("league.season.counted.avg");
    expect(seasons(avg, "avg")).toEqual([
      [1, 2030, 97.5],
      [2, 2031, 95.278],
    ]);
  });

  it("scope switches the games that count; byes and games outside the brackets never do", async () => {
    // Playoffs: 2030 weeks 4+5 = 460 + 415 = 875 over 8 games; 2031 = 415 + 435 = 850.
    const playoffs = await w.run("league.season.counted.total", { scope: "playoffs" });
    expect(seasons(playoffs, "total", "games", "avg")).toEqual([
      [1, 2030, 875, 8, 109.375],
      [2, 2031, 850, 8, 106.25],
    ]);
    // All: 1755 + 875 = 2630 and 1715 + 850 = 2565, over 26 team-games each (teams 5 and 6 add nothing after week 3).
    const all = await w.run("league.season.counted.total", { scope: "all" });
    expect(seasons(all, "total", "games", "avg")).toEqual([
      [1, 2030, 2630, 26, 101.154],
      [2, 2031, 2565, 26, 98.654],
    ]);
  });

  it("bench points: bench + IR of every counted team-week", async () => {
    // 2030 regular: wk1 0.2 x 600 + 6 x 7 = 162, wk2 0 (even week), wk3 0.2 x 605 + 42 = 163 -> 325, / 18 = 18.056.
    // 2031: wk1 163, wk2 0, wk3 116 + 42 = 158 -> 321, / 18 = 17.833.
    const total = await w.run("league.season.bench.total");
    expect(seasons(total, "total", "avg")).toEqual([
      [1, 2030, 325, 18.056],
      [2, 2031, 321, 17.833],
    ]);
    expect(total.meta.requires).toContain("playerData");
    const avg = await w.run("league.season.bench.avg");
    expect(seasons(avg, "avg")).toEqual([
      [1, 2030, 18.056],
      [2, 2031, 17.833],
    ]);
  });

  it("teamwide points: everything every rostered player scored", async () => {
    // Score plus bench: 2030 1755 + 325 = 2080 (/ 18 = 115.556), 2031 1715 + 321 = 2036 (/ 18 = 113.111).
    const total = await w.run("league.season.teamwide.total");
    expect(seasons(total, "total", "avg")).toEqual([
      [1, 2030, 2080, 115.556],
      [2, 2031, 2036, 113.111],
    ]);
    const avg = await w.run("league.season.teamwide.avg");
    expect(seasons(avg, "avg")).toEqual([
      [1, 2030, 115.556],
      [2, 2031, 113.111],
    ]);
  });

  it("sorting the ranked column the other way ranks the lowest first", async () => {
    const res = await w.run("league.season.counted.total", { sort: "total", dir: "asc" });
    expect(seasons(res, "total")).toEqual([
      [1, 2031, 1715],
      [2, 2030, 1755],
    ]);
  });

  it("an in-progress season is left out of the totals but kept, and flagged, in the averages", async () => {
    await w.db
      .update(leagueSeason)
      .set({ status: "in_season" })
      .where(eq(leagueSeason.id, w.fixture.seasonIds[2031]!));
    try {
      for (const measure of ["counted", "bench", "teamwide"]) {
        const total = await w.run(`league.season.${measure}.total`);
        expect(total.seasonsIncluded, `${measure} total`).toEqual([2030]);
        expect(total.rows.map((r) => r.values.season)).toEqual([2030]);
        const avg = await w.run(`league.season.${measure}.avg`);
        expect(avg.seasonsIncluded, `${measure} avg`).toEqual([2030, 2031]);
        expect(avg.rows.map((r) => [r.values.season, r.inProgress])).toEqual([
          [2030, false],
          [2031, true],
        ]);
      }
      // Single weeks just include it.
      expect((await w.run("league.week.counted.total", { limit: 50 })).seasonsIncluded).toEqual([
        2030, 2031,
      ]);
    } finally {
      await w.db
        .update(leagueSeason)
        .set({ status: "complete" })
        .where(eq(leagueSeason.id, w.fixture.seasonIds[2031]!));
    }
  });

  it("a two-week game is left out of the totals and the average", async () => {
    // Make 2030's week-5 game between teams 1 and 3 (105 + 125 = 230) a two-week game: playoffs drop to 645 / 6 games.
    const where = and(
      eq(matchup.leagueSeasonId, w.fixture.seasonIds[2030]!),
      eq(matchup.week, 5),
      eq(matchup.externalMatchupId, 1)
    );
    await w.db.update(matchup).set({ spanWeeks: 2 }).where(where);
    try {
      const res = await w.run("league.season.counted.total", { scope: "playoffs" });
      expect(seasons(res, "total", "games", "avg")).toEqual([
        [1, 2031, 850, 8, 106.25],
        [2, 2030, 645, 6, 107.5],
      ]);
      const week = await w.run("league.week.counted.total", {
        scope: "playoffs",
        seasons: "2030",
      });
      expect(weeks(week, "total", "games")).toEqual([
        [1, 2030, 4, 460, 4],
        [2, 2030, 5, 185, 2],
      ]);
    } finally {
      await w.db.update(matchup).set({ spanWeeks: 1 }).where(where);
    }
  });
});

describe("league scoring by week", () => {
  it("counted points: weeks tie for a place, ordered by season then week", async () => {
    // 2030 wk3 and 2031 wk1 both scored 605.
    const res = await w.run("league.week.counted.total");
    expect(weeks(res, "total", "avg", "games")).toEqual([
      [1, 2030, 3, 605, 100.833, 6],
      [1, 2031, 1, 605, 100.833, 6],
      [3, 2030, 1, 600, 100, 6],
      [4, 2031, 3, 580, 96.667, 6],
      [5, 2030, 2, 550, 91.667, 6],
      [6, 2031, 2, 530, 88.333, 6],
    ]);
  });

  it("the average is per team-game, so a four-team playoff week can lead it", async () => {
    // Scope "all". Playoff weeks have four games: 2030 wk4 460 / 4 = 115, 2031 wk5 435 / 4 = 108.75, then the 103.75
    // tie of 2030 wk5 (415) and 2031 wk4 (415); teams 5 and 6 add nothing in weeks 4 and 5. Six-team weeks follow:
    // 605 / 6 = 100.833 (a tie), 600 / 6 = 100, 580 / 6 = 96.667.
    const res = await w.run("league.week.counted.avg", { scope: "all", limit: 7 });
    expect(weeks(res, "avg", "total", "games")).toEqual([
      [1, 2030, 4, 115, 460, 4],
      [2, 2031, 5, 108.75, 435, 4],
      [3, 2030, 5, 103.75, 415, 4],
      [3, 2031, 4, 103.75, 415, 4],
      [5, 2030, 3, 100.833, 605, 6],
      [5, 2031, 1, 100.833, 605, 6],
      [7, 2030, 1, 100, 600, 6],
    ]);
    // Ranked by the total instead, the six-team weeks lead.
    const byTotal = await w.run("league.week.counted.total", { scope: "all", limit: 3 });
    expect(weeks(byTotal, "total")).toEqual([
      [1, 2030, 3, 605],
      [1, 2031, 1, 605],
      [3, 2030, 1, 600],
    ]);
  });

  it("bench points: 0.2 x score + 7 per team on odd weeks, nothing on even weeks", async () => {
    // 2030 wk1 162 / wk2 0 / wk3 163; 2031 wk1 163 / wk2 0 / wk3 158. The two empty weeks tie.
    const res = await w.run("league.week.bench.total");
    expect(weeks(res, "total", "avg")).toEqual([
      [1, 2030, 3, 163, 27.167],
      [1, 2031, 1, 163, 27.167],
      [3, 2030, 1, 162, 27],
      [4, 2031, 3, 158, 26.333],
      [5, 2030, 2, 0, 0],
      [5, 2031, 2, 0, 0],
    ]);
  });

  it("teamwide points: score plus bench, and the weeks filter narrows the weeks", async () => {
    const res = await w.run("league.week.teamwide.total");
    expect(weeks(res, "total", "avg")).toEqual([
      [1, 2030, 3, 768, 128],
      [1, 2031, 1, 768, 128],
      [3, 2030, 1, 762, 127],
      [4, 2031, 3, 738, 123],
      [5, 2030, 2, 550, 91.667],
      [6, 2031, 2, 530, 88.333],
    ]);
    const narrowed = await w.run("league.week.teamwide.avg", { weeks: "2-2" });
    expect(weeks(narrowed, "avg")).toEqual([
      [1, 2030, 2, 91.667],
      [2, 2031, 2, 88.333],
    ]);
  });

  it("the lowest week is the same record sorted the other way", async () => {
    const res = await w.run("league.week.counted.total", { sort: "total", dir: "asc", limit: 2 });
    expect(weeks(res, "total")).toEqual([
      [1, 2031, 2, 530],
      [2, 2030, 2, 550],
    ]);
  });
});
