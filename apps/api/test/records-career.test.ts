import { sql } from "@rfp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runRecord } from "../src/records/run";
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
      placePct: 0.7, // 6 teams: (6-2)/5 and (6-3)/5
    });
    expect(best["Team 4"]?.values).toMatchObject({ bestPlace: 2, placePct: 0.6 }); // places 2 and 4
    const res = await w.run("career.place.best");
    expect(res.rows.map((r) => [w.team(res, r), r.rank]).slice(0, 3)).toEqual([
      ["Team 3", 1],
      ["Team 1", 2],
      ["Team 4", 2],
    ]);
    const worst = await w.run("career.place.worst");
    expect(w.team(worst, worst.rows[0]!)).toBe("Team 5");
  });

  it("weighted placement ranks best first and counts a place in a bigger league for more", async () => {
    const res = await w.run("career.place.avg");
    expect(res.rows.map((r) => [w.team(res, r), r.rank]).slice(0, 2)).toEqual([
      ["Team 3", 1],
      ["Team 1", 2],
    ]);
    expect(res.meta.sortKey).toBe("placePct");
    expect(res.meta.direction).toBe("desc");
    // 2031 as a 12-team league: Team 1's 3rd there is (12-3)/11, better than the 6-team (6-3)/5
    const season31 = w.fixture.seasonIds[2031]!;
    await w.db.execute(sql`update league_season set team_count = 12 where id = ${season31}`);
    try {
      const big = byTeam(await w.run("career.place.avg"));
      expect(big["Team 1"]?.values.placePct).toBeCloseTo((4 / 5 + 9 / 11) / 2, 4);
    } finally {
      await w.db.execute(sql`update league_season set team_count = 6 where id = ${season31}`);
    }
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

describe("power rating", () => {
  it("rates every manager on the 1500 / 250-per-sd scale and honours the seasons filter", async () => {
    const res = await w.run("career.power");
    expect(res.rows.length).toBe(6);
    expect(res.meta.sortKey).toBe("rating");
    expect(res.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    const values = res.rows.map((r) => r.values.value as number);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    // calibrated on itself, the display scale averages 1500 with a standard deviation of 250
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(mean).toBeCloseTo(1500, 1);
    expect(Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)).toBeCloseTo(
      250,
      0
    );
    for (const r of res.rows) expect(r.values).toMatchObject({ seasons: 2, missed: 0 });
    expect(res.rows[0]!.values.winPct as number).toBeGreaterThan(
      res.rows[5]!.values.winPct as number
    );
    expect(res.rows[0]!.values.games as number).toBeGreaterThan(5);
    expect(res.rows.every((r) => r.values.placePct !== undefined)).toBe(true);

    // one season, scored on the full history's scale: the same managers, a different (narrower) spread
    const one = await w.run("career.power", { seasons: "2030" });
    expect(one.rows.length).toBe(6);
    for (const r of one.rows) expect(r.values.seasons).toBe(1);
    expect(one.rows.map((r) => r.values.value)).not.toEqual(values);
    const ones = one.rows.map((r) => r.values.value as number);
    const oneMean = ones.reduce((s, v) => s + v, 0) / ones.length;
    expect(Math.sqrt(ones.reduce((s, v) => s + (v - oneMean) ** 2, 0) / ones.length)).toBeLessThan(
      250
    );
  });
});

describe("power rating cache key", () => {
  it("covers every season (it calibrates on the full history), unlike a record that reads only the filtered ones", async () => {
    const season2031 = w.fixture.seasonIds[2031]!;
    const key = async (id: string) =>
      (await runRecord(w.db, w.fixture.leagueId, id, { seasons: "2030" }, { noCache: true }))
        .dataVersion;
    const power = await key("career.power");
    const pf = await key("career.pf");
    await w.db.execute(
      sql`update data_version set version = version + 1 where league_season_id = ${season2031}`
    );
    expect(await key("career.power")).not.toBe(power);
    expect(await key("career.pf")).toBe(pf);
  });
});

describe("point differential records", () => {
  /** Independent computation from the raw per-team game rows. */
  async function truth() {
    const rows = (
      await w.db.execute<{ f: number; m: number }>(
        sql`select franchise_id as f, margin::float8 as m from rec_team_week where margin is not null and span_weeks = 1`
      )
    ).rows;
    const by = new Map<number, number[]>();
    for (const r of rows) by.set(Number(r.f), [...(by.get(Number(r.f)) ?? []), Number(r.m)]);
    return by;
  }
  const sd = (v: number[]) => {
    const mu = v.reduce((s, x) => s + x, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / (v.length - 1));
  };

  it("reports the average, worst, best and standard deviation of each manager's game margins", async () => {
    const t = await truth();
    const res = await w.run("career.diff.avg");
    expect(res.rows.length).toBe(6);
    for (const r of res.rows) {
      const f = r.refs.franchiseId as number;
      const m = t.get(f)!;
      expect(r.values.games).toBe(m.length);
      expect(r.values.avg as number).toBeCloseTo(m.reduce((s, x) => s + x, 0) / m.length, 3);
      expect(r.values.min as number).toBeCloseTo(Math.min(...m), 3);
      expect(r.values.max as number).toBeCloseTo(Math.max(...m), 3);
      expect(r.values.stddev as number).toBeCloseTo(sd(m), 3);
    }
    // every game has a winner and a loser, so margins cancel across the league
    const total = res.rows.reduce(
      (s, r) => s + (r.values.avg as number) * (r.values.games as number),
      0
    );
    expect(total).toBeCloseTo(0, 2);
  });

  it("ranks highest average first, worst single game first, best single game first, most volatile first", async () => {
    const avg = (await w.run("career.diff.avg")).rows.map((r) => r.values.value as number);
    expect(avg).toEqual([...avg].sort((a, b) => b - a));
    const min = (await w.run("career.diff.min")).rows.map((r) => r.values.value as number);
    expect(min).toEqual([...min].sort((a, b) => a - b));
    expect(min[0]!).toBeLessThan(0);
    const max = (await w.run("career.diff.max")).rows.map((r) => r.values.value as number);
    expect(max).toEqual([...max].sort((a, b) => b - a));
    expect(max[0]!).toBeGreaterThan(0);
    const dev = (await w.run("career.diff.stddev")).rows.map((r) => r.values.value as number);
    expect(dev).toEqual([...dev].sort((a, b) => b - a));
  });

  it("honours the scope filter", async () => {
    const reg = await w.run("career.diff.max", { scope: "regular" });
    const all = await w.run("career.diff.max");
    const top = (res: typeof reg) => Math.max(...res.rows.map((r) => r.values.max as number));
    expect(top(reg)).toBeLessThanOrEqual(top(all));
    for (const r of reg.rows) expect(r.values.games as number).toBeGreaterThan(0);
  });
});
