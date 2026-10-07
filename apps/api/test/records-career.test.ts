import { sql } from "@rfp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w?.close();
});

type Res = Awaited<ReturnType<World["run"]>>;
const byTeam = (res: Res) => Object.fromEntries(res.rows.map((r) => [w.team(res, r), r]));

describe("career standings (doc §2: ties, medians, per-season streaks)", () => {
  it("totals W-L-T across seasons with the season's median default", async () => {
    const res = await w.run("career.wins");
    const t = byTeam(res);
    expect(t["Team 1"]?.values).toMatchObject({
      years: 2,
      wins: 11,
      losses: 3,
      ties: 2,
      winPct: 0.75,
    });
    expect(t["Team 3"]?.values).toMatchObject({ wins: 11, losses: 5, ties: 0 });
    expect(t["Team 2"]?.values).toMatchObject({ wins: 2, losses: 12, ties: 2 });
    expect(res.rows.map((r) => r.rank).slice(0, 3)).toEqual([1, 1, 3]); // Teams 1 and 3 both have 11 wins...
  });

  it("longest win streak is per season and lists every season that holds it", async () => {
    const res = await w.run("career.win-streak");
    const t = byTeam(res);
    // 2030: T T W W W W W L  -> the tie ends nothing here but starts the run at week 2; the best run is 5
    expect(t["Team 1"]?.values).toMatchObject({ winStreak: 5, winStreakSeasons: [2030] });
    const loss = byTeam(await w.run("career.loss-streak"));
    expect(loss["Team 2"]?.values).toMatchObject({ lossStreak: 8, lossStreakSeasons: [2031] });
    // Team 1's longest loss run is 1 in both seasons: both are listed
    expect(loss["Team 1"]?.values).toMatchObject({
      lossStreak: 1,
      lossStreakSeasons: [2030, 2031],
    });
  });

  it("median mode changes what a streak is made of (doc §1.4 bug 5)", async () => {
    const exclude = byTeam(await w.run("career.win-streak", { median: "exclude" }));
    // head-to-head only: 2030 T W W W L -> 3; 2031 W W L L W -> 2
    expect(exclude["Team 1"]?.values).toMatchObject({ winStreak: 3, winStreakSeasons: [2030] });
    const only = byTeam(await w.run("career.win-streak", { median: "only" }));
    // median games only: 2030 T W W -> 2; 2031 W W W -> 3
    expect(only["Team 1"]?.values).toMatchObject({ winStreak: 3, winStreakSeasons: [2031] });
  });

  it("a tie ends both a win streak and a loss streak", async () => {
    // Team 2 in 2030, median included: T T L W L L L W; the opening ties start nothing, and the median win at
    // week 2 splits the losses: the longest loss run is 3 (week 3 h2h + median, week 4)
    const loss = byTeam(await w.run("career.loss-streak", { seasons: "2030" }));
    expect(loss["Team 2"]?.values).toMatchObject({ lossStreak: 3, lossStreakSeasons: [2030] });
    const win = byTeam(await w.run("career.win-streak", { seasons: "2030" }));
    expect(win["Team 2"]?.values.winStreak).toBe(1);
  });

  it("'Postseason + include medians' counts only postseason games (doc §1.4 bug 1)", async () => {
    const res = await w.run("career.wins", { scope: "postseason", median: "include" });
    const t = byTeam(res);
    // Team 1: 2030 W (wk4) L (wk5); 2031 L (wk4) W (wk5). No regular-season median wins sneak in.
    expect(t["Team 1"]?.values).toMatchObject({ wins: 2, losses: 2, ties: 0 });
    expect(t["Team 5"]).toBeUndefined(); // no postseason games, so no row
  });

  it("years in league respects the season filter (doc §1.4 bug 4)", async () => {
    const all = byTeam(await w.run("career.years"));
    expect(all["Team 1"]?.values.years).toBe(2);
    const one = byTeam(await w.run("career.years", { seasons: "2031" }));
    expect(one["Team 1"]?.values.years).toBe(1);
    expect(one["Team 1"]?.values.wins).toBe(6);
  });

  it("win % has a qualifier of 10 games for the all/regular scope", async () => {
    const res = await w.run("career.winpct");
    expect(res.meta.qualifier).toEqual({ minGames: 10 });
    expect(res.rows.length).toBe(6); // every franchise played 14-16 games over two seasons
    expect(res.rows[0]?.values.winPct).toBe(0.75);
  });
});

describe("career placements (from the brackets)", () => {
  it("highest, lowest and average placement with every holding season", async () => {
    const best = byTeam(await w.run("career.place.best"));
    expect(best["Team 3"]?.values).toMatchObject({ bestPlace: 1, bestPlaceSeasons: [2030, 2031] });
    expect(best["Team 1"]?.values).toMatchObject({
      bestPlace: 2,
      bestPlaceSeasons: [2030],
      worstPlace: 3,
      worstPlaceSeasons: [2031],
      avgPlace: 2.5,
    });
    expect(best["Team 4"]?.values).toMatchObject({ bestPlace: 2, avgPlace: 3 });
    const res = await w.run("career.place.best");
    expect(res.rows.map((r) => [w.team(res, r), r.rank]).slice(0, 3)).toEqual([
      ["Team 3", 1],
      ["Team 1", 2],
      ["Team 4", 2],
    ]);
    const worst = await w.run("career.place.worst");
    expect(w.team(worst, worst.rows[0]!)).toBe("Team 5");
  });

  it("playoff and toilet bowl appearances follow the brackets, not the standings", async () => {
    const res = await w.run("career.playoffs");
    const t = byTeam(res);
    expect(t["Team 1"]?.values.playoffs).toBe(2);
    expect(t["Team 5"]?.values.playoffs).toBe(0);
    // These seasons have no losers bracket, so nobody has a toilet bowl appearance.
    expect(Object.values(t).every((r) => r.values.toiletBowls === 0)).toBe(true);
  });
});

describe("career lineups and scoring", () => {
  it("perfect lineups, missed points and lineup IQ", async () => {
    const perfect = byTeam(await w.run("career.perfect"));
    // Even weeks are perfect (bench RB scores 0): Team 1 has 2 counted even weeks per season, Team 5 has 1.
    expect(perfect["Team 1"]?.values.perfect).toBe(4);
    expect(perfect["Team 5"]?.values.perfect).toBe(2);
    const missed = byTeam(await w.run("career.missed"));
    expect(missed["Team 1"]?.values.missed).toBe(42); // 6 counted odd weeks x 7
    expect(missed["Team 5"]?.values.missed).toBe(28);
    const asc = await w.run("career.missed");
    expect(asc.meta.direction).toBe("asc");
    // fewest counted odd weeks: Teams 5 and 6 tie at 28
    expect(asc.rows.filter((r) => r.rank === 1).map((r) => w.team(asc, r))).toEqual([
      "Team 5",
      "Team 6",
    ]);
  });

  it("highest/lowest score with every week that holds it; PF/PA/PFPG", async () => {
    const hi = await w.run("career.score.high");
    expect(w.team(hi, hi.rows[0]!)).toBe("Team 3");
    expect(hi.rows[0]?.values).toMatchObject({ highScore: 140, highScoreWhen: ["2030 WK 3"] });
    const lo = await w.run("career.score.low");
    expect(
      lo.rows
        .filter((r) => r.rank === 1)
        .map((r) => w.team(lo, r))
        .sort()
    ).toEqual(["Team 2", "Team 6"]);
    const t6 = byTeam(lo)["Team 6"]!;
    expect(t6.values).toMatchObject({ lowScore: 60, lowScoreWhen: ["2030 WK 2", "2031 WK 2"] });
    const pf = byTeam(await w.run("career.pf"));
    expect(pf["Team 3"]?.values).toMatchObject({ pf: 1155, games: 10, pfpg: 115.5 });
    const pfAll = await w.run("career.pf");
    expect(w.team(pfAll, pfAll.rows[0]!)).toBe("Team 3");
  });

  it("scope filters PF to the regular season", async () => {
    const pf = byTeam(await w.run("career.pf", { scope: "regular" }));
    expect(pf["Team 3"]?.values).toMatchObject({ pf: 100 + 120 + 90 + 140 + 95 + 125, games: 6 });
  });
});

describe("a franchise that changed hands (doc §2: current manager in general, the old one only for that year)", () => {
  it("career rows show the current manager, or the season's manager when the filter selects one season", async () => {
    const q = async (text: string) =>
      (await w.db.execute<Record<string, number>>(sql.raw(text))).rows;
    const [{ id: m5 }] = (await q("select id from manager where name = 'Manager 5'")) as [
      { id: number },
    ];
    const [{ id: ts31 }] = (await q(
      "select ts.id from team_season ts join league_season ls on ls.id = ts.league_season_id where ls.year = 2031 and ts.name = 'Team 1'"
    )) as [{ id: number }];
    await w.db.execute(
      sql.raw(
        `update team_season_manager set manager_id = ${m5} where team_season_id = ${ts31} and role = 'primary'`
      )
    );
    try {
      const managerOf = async (query: Record<string, unknown>) => {
        const res = await w.run("career.wins", query);
        const row = res.rows.find((r) => w.team(res, r).startsWith("Team 1"))!;
        return res.entities.managers[row.refs.managerId!]?.name;
      };
      expect(await managerOf({})).toBe("Manager 5"); // all seasons: the franchise's current manager
      expect(await managerOf({ seasons: "2031" })).toBe("Manager 5");
      expect(await managerOf({ seasons: "2030" })).toBe("Manager 1"); // only that year: the manager of that year
    } finally {
      await w.db.execute(
        sql.raw(
          `update team_season_manager set manager_id = (select id from manager where name = 'Manager 1') where team_season_id = ${ts31} and role = 'primary'`
        )
      );
    }
  });
});
