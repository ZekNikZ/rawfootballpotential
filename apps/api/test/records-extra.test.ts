import { RECORD_CATALOG } from "@rfp/core";
import { deriveSeason } from "@rfp/ingest/testing";
import { sql } from "@rfp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorld, type World } from "./helpers";

// The additional records of doc 4.5, checked against the hand-built fixture leagues (both seasons: 6 teams, median on,
// regular weeks 1-3, playoffs weeks 4-5 for teams 1-4). Every expected value below was worked out by hand from the
// scores in fixture-league.ts; see the comments for the arithmetic.

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w?.close();
});

type Res = Awaited<ReturnType<World["run"]>>;
const rows = (res: Res, ...keys: string[]) =>
  res.rows.map((r) => [r.rank, w.team(res, r), ...keys.map((k) => r.values[k])]);

describe("luck and regret", () => {
  it("unluckiest loss: the loss with the best weekly score rank, then the higher score", async () => {
    // 2030: Team 1 lost week 5 with the 2nd-highest score of 4 teams; then three 3rd-ranked losses by score.
    const res = await w.run("luck.unluckiest-loss", { seasons: "2030", limit: 4 });
    expect(rows(res, "week", "rankText")).toEqual([
      [1, "Team 1", 5, "2 of 4"],
      [2, "Team 4", 4, "3 of 4"],
      [3, "Team 4", 3, "3 of 6"],
      [4, "Team 2", 2, "3 of 6"],
    ]);
  });

  it("luckiest win: the win with the worst weekly rank, then the lower score", async () => {
    // Team 5 won week 2 with 70, 5th of 6; then Team 6 week 3 (95, 4th of 6) and Team 2 week 5 (95, 3rd of 4).
    const res = await w.run("luck.luckiest-win", { seasons: "2030", limit: 3 });
    expect(rows(res, "week", "rankText")).toEqual([
      [1, "Team 5", 2, "5 of 6"],
      [2, "Team 6", 3, "4 of 6"],
      [3, "Team 2", 5, "3 of 4"],
    ]);
  });

  it("should've won: lost, but the optimal lineup beats the opponent's actual score", async () => {
    // Odd weeks have a bench RB 7 points better than the FLEX. Only Team 4's week-5 loss (90 vs 95) flips: 97 > 95.
    const res = await w.run("shouldve-won", { seasons: "2030" });
    expect(rows(res, "week", "left", "points", "opponentPoints")).toEqual([
      [1, "Team 4", 5, 7, 90, 95],
    ]);
    const career = await w.run("career.shouldve-won", { seasons: "2030" });
    const team4 = career.rows.find((r) => w.team(career, r) === "Team 4");
    expect(team4?.values).toMatchObject({ count: 1, losses: 4 });
  });

  it("median splits: won the game but not the median, and the reverse", async () => {
    // Medians 2030: wk 2 92.5, wk 3 97.5. Team 5 won wk 2 with 70 (22.5 under), Team 6 won wk 3 with 95 (2.5 under);
    // Team 2 (wk 2, 95) and Team 4 (wk 3, 100) lost their games but beat the median by 2.5.
    const a = await w.run("median.won-h2h-lost", { seasons: "2030" });
    expect(rows(a, "week", "gap")).toEqual([
      [1, "Team 5", 2, -22.5],
      [2, "Team 6", 3, -2.5],
    ]);
    const b = await w.run("median.lost-h2h-won", { seasons: "2030" });
    expect(rows(b, "week", "gap")).toEqual([
      [1, "Team 2", 2, 2.5],
      [1, "Team 4", 3, 2.5],
    ]);
  });

  it("closest playoff loss only looks at playoff games", async () => {
    const res = await w.run("heartbreak.playoff-loss", { limit: 3 });
    expect(res.params.scope).toBe("playoffs");
    // Five-point losses: 2030 week 5 (Team 4, 90-95) and 2031 week 5 (Team 2, 95-100).
    expect(res.rows[0]?.values.value).toBe(5);
  });
});

describe("all-play luck", () => {
  it("all-play win % and luck = actual wins - wins the all-play record predicts", async () => {
    // 2030 regular weeks 1-3, all-play over 15 games each (ties count half):
    //   T1 11-3-1 .7667, T2 6-8-1 .4333, T3 12-3 .8, T4 7-8 .4667, T5 2-13 .1333, T6 6-9 .4
    // Actual head-to-head wins: T1 T,W,W = 2.5; T2 T,L,L = 0.5; T3 2; T4 1; T5 1; T6 2. Expected = pct x 3 games.
    const best = await w.run("season.allplay.high", { seasons: "2030", minGames: 1, limit: 6 });
    expect(rows(best, "allPlay", "record")[0]).toEqual([1, "Team 3", "12-3", "2-1"]);
    expect(Number(best.rows[0]?.values.allPlayPct)).toBeCloseTo(0.8, 4);
    expect(best.rows.map((r) => w.team(best, r))).toEqual([
      "Team 3",
      "Team 1",
      "Team 4",
      "Team 2",
      "Team 6",
      "Team 5",
    ]);
    const lucky = await w.run("season.luck.high", { seasons: "2030", minGames: 1, limit: 6 });
    expect(
      lucky.rows.map((r) => [w.team(lucky, r), Number(Number(r.values.luck).toFixed(2))])
    ).toEqual([
      ["Team 6", 0.8],
      ["Team 5", 0.6],
      ["Team 1", 0.2],
      ["Team 3", -0.4],
      ["Team 4", -0.4],
      ["Team 2", -0.8],
    ]);
    const unlucky = await w.run("season.luck.low", { seasons: "2030", minGames: 1, limit: 1 });
    expect(rows(unlucky)[0]).toEqual([1, "Team 2"]);
  });

  it("the qualifier keeps short seasons out unless the minimum is lowered", async () => {
    const res = await w.run("season.luck.high", { seasons: "2030" });
    expect(res.total).toBe(0); // 3 regular-season games < the 8-game minimum
    expect(res.meta.qualifier).toEqual({ minGames: 8 });
  });
});

describe("schedule swap", () => {
  it("plays a team's scores against every other team's schedule", async () => {
    // Team 5 (90, 70, 75). Against Team 3's schedule (opponents 80, 130, 85) it goes 1-2; against Teams 1, 2 and 4
    // it goes 0-3; Team 6's schedule is Team 5 every week, so those games are skipped.
    const best = await w.run("season.schedule.best", { seasons: "2030", limit: 6 });
    const row = best.rows.find((r) => w.team(best, r) === "Team 5")!;
    expect(row.values).toMatchObject({ record: "1-2", actual: "1-2" });
    expect(best.entities.teamSeasons[row.refs.opponentTeamSeasonId!]?.name).toBe("Team 3");
    const worst = await w.run("season.schedule.worst", { seasons: "2030", limit: 6 });
    const w5 = worst.rows.find((r) => w.team(worst, r) === "Team 5")!;
    expect(w5.values).toMatchObject({ record: "0-3", winPct: 0 });
  });
});

describe("weekly highs and lows", () => {
  it("counts weeks as the league's top and lowest scorer, by season and career", async () => {
    // Top scorers 2030: W1 T3 120, W2 T1 130, W3 T3 140, W4 T3 130, W5 T3 125. Lowest: T4 (80), T6 (60), T5 (75),
    // T2 (100 of the four playoff teams), T4 (90).
    const top = await w.run("season.top-scorer", { seasons: "2030", limit: 2 });
    expect(rows(top, "count", "weeks")).toEqual([
      [1, "Team 3", 4, 5],
      [2, "Team 1", 1, 5],
    ]);
    const bottom = await w.run("season.bottom-scorer", { seasons: "2030", limit: 1 });
    expect(rows(bottom, "count")).toEqual([[1, "Team 4", 2]]);
    const career = await w.run("career.top-scorer", { seasons: "2030" });
    expect(career.rows[0]?.values).toMatchObject({ count: 4, weeks: 5 });
    expect(Number(career.rows[0]?.values.pct)).toBeCloseTo(0.8, 4);
  });
});

describe("seeds, finishes and champions", () => {
  it("lowest seed to win the title, and the worst finish by a top seed", async () => {
    // Team 3 won both seasons: seed 2 in 2030, seed 3 in 2031. Team 1 was the top seed both years and finished 2nd, 3rd.
    const low = await w.run("seed.lowest-champion");
    expect(rows(low, "season", "seed")).toEqual([
      [1, "Team 3", 2031, 3],
      [2, "Team 3", 2030, 2],
    ]);
    const top = await w.run("seed.top-worst");
    expect(rows(top, "season", "finalPlace")).toEqual([
      [1, "Team 1", 2031, 3],
      [2, "Team 1", 2030, 2],
    ]);
  });

  it("worst champion and best non-champion rank regular-season points", async () => {
    // Team 3's regular PF: 350 (2030), 320 (2031). Team 1's 340 in both seasons is the best non-champion.
    const worst = await w.run("champ.worst");
    expect(rows(worst, "season", "pf")).toEqual([
      [1, "Team 3", 2031, 320],
      [2, "Team 3", 2030, 350],
    ]);
    const best = await w.run("champ.best-non", { limit: 3 });
    expect(rows(best, "season", "pf").slice(0, 2)).toEqual([
      [1, "Team 1", 2030, 340],
      [1, "Team 1", 2031, 340],
    ]);
  });

  it("worst record to make the playoffs and best record to miss them (head to head, regular season)", async () => {
    // Regular h2h win %, 2030: T1 .833 T2 .167 T3 .667 T4 .333 T5 .333 T6 .667;
    // 2031: T1 .667 T2 0 T3 .333 T4 1 T5 .333 T6 .667.
    // Teams 1-4 made the playoffs both years (Team 2 with a low seed); 5 and 6 missed.
    const worst = await w.run("seed.worst-record-playoffs", { median: "exclude", limit: 2 });
    expect(worst.rows.map((r) => [r.rank, w.team(worst, r), r.values.season])).toEqual([
      [1, "Team 2", 2031],
      [2, "Team 2", 2030],
    ]);
    expect(Number(worst.rows[1]?.values.winPct)).toBeCloseTo(0.1667, 3);
    const missed = await w.run("seed.best-record-missed", { median: "exclude", limit: 3 });
    expect(missed.rows.slice(0, 2).map((r) => [r.rank, w.team(missed, r)])).toEqual([
      [1, "Team 6"],
      [1, "Team 6"],
    ]);
  });
});

describe("close games and blowouts", () => {
  it("counts games decided by fewer than 5 (strictly) and more than 50", async () => {
    // Five-point games exist (2030 week 5, 2031 weeks 1 and 5) but none is under 5.
    expect((await w.run("career.close.wins")).rows.length).toBe(0);
    // 55 (2030 week 3) and 65 (2031 week 3): Team 3 beat Team 2 both times.
    const wins = await w.run("career.blowout.wins");
    expect(rows(wins, "wins", "losses")[0]).toEqual([1, "Team 3", 2, 0]);
    const losses = await w.run("career.blowout.losses");
    expect(rows(losses, "wins", "losses")[0]).toEqual([1, "Team 2", 0, 2]);
  });
});

describe("rivalries", () => {
  it("most-played pairing, with the winning side listed first", async () => {
    // Teams 5 and 6 play each other every regular week, six games over both seasons: Team 6 won 4.
    const res = await w.run("rivalry.most-played", { limit: 3 });
    expect(rows(res, "games", "record")[0]).toEqual([1, "Team 6", 6, "4-2"]);
    const opponent = res.entities.franchises[res.rows[0]!.refs.opponentFranchiseId!];
    expect(opponent?.teamName).toBe("Team 5");
    expect(res.rows.slice(1).every((r) => r.values.games === 4)).toBe(true);
  });

  it("most lopsided head to head needs a minimum series, and the win streak runs across seasons", async () => {
    // With 3+ games: Team 3 beat Team 2 four times (2030 weeks 3 and 4; 2031 weeks 3 and 4).
    const res = await w.run("rivalry.lopsided", { minGames: 3, limit: 2 });
    expect(rows(res, "games", "record")[0]).toEqual([1, "Team 3", 4, "4-0"]);
    const strict = await w.run("rivalry.lopsided"); // six games minimum (the qualifier)
    expect(rows(strict, "games", "record")).toEqual([[1, "Team 6", 6, "4-2"]]);
    const streak = await w.run("rivalry.streak", { limit: 1 });
    expect(rows(streak, "streak", "span")).toEqual([[1, "Team 3", 4, "2030 WK 3 - 2031 WK 4"]]);
  });
});

describe("droughts and dynasties", () => {
  it("runs of seasons without a title, with playoff trips and toilet bowls", async () => {
    const drought = await w.run("drought.title", { limit: 10 });
    // Team 3 won both seasons (a run of 0); every other team is 2 seasons without one.
    expect(drought.rows.filter((r) => r.values.run === 2).length).toBe(5);
    expect(drought.rows.find((r) => w.team(drought, r) === "Team 3")?.values.run).toBe(0);
    const playoffs = await w.run("streak.playoffs", { limit: 10 });
    expect(playoffs.rows.filter((r) => r.values.run === 2).length).toBe(4);
    expect((await w.run("streak.toilet-bowl")).rows.every((r) => r.values.run === 0)).toBe(true);
  });
});

describe("draft value (2031 snake draft: round 1 QBs, round 2 RBs, round 3 WRs, in slot order)", () => {
  it("steals and busts compare the draft slot with the season's finish among QB / RB / WR", async () => {
    // Every team's players score fixed shares of its weekly points, so the finishes are fixed: for each position the
    // order is Team 3, 1, 4, then Teams 2 and 6 tied, then Team 5. A pick that finishes 2 places better than its slot
    // is a steal (Teams 3 and 6), 2 places worse a bust (Team 2).
    const steal = await w.run("draft.steal", { limit: 10 });
    expect(steal.rows.filter((r) => r.rank === 1).length).toBe(6);
    expect(steal.rows[0]?.values.gain).toBe(2);
    const bust = await w.run("draft.bust", { limit: 10 });
    expect(bust.rows.filter((r) => r.rank === 1).length).toBe(3);
    expect(bust.rows[0]?.values.gain).toBe(-2);
    expect(new Set(bust.rows.filter((r) => r.rank === 1).map((r) => w.team(bust, r)))).toEqual(
      new Set(["Team 2"])
    );
  });

  it("best pick of each round, and the best and worst draft classes", async () => {
    // Team 3's players lead every round: QB 275, RB 165, WR 110 over 2031's five weeks.
    const byRound = await w.run("draft.best-by-round");
    expect(rows(byRound, "round", "points")).toEqual([
      [1, "Team 3", 1, 275],
      [2, "Team 3", 2, 165],
      [3, "Team 3", 3, 110],
    ]);
    // A class's starter points are its team's counted points: Team 3 550 (five counted weeks), Team 5 255 (three).
    const best = await w.run("draft.class.best", { limit: 1 });
    expect(rows(best, "classPoints", "picks")).toEqual([[1, "Team 3", 550, 3]]);
    const worst = await w.run("draft.class.worst", { limit: 1 });
    expect(rows(worst, "classPoints")).toEqual([[1, "Team 5", 255]]);
  });
});

describe("pickups and tenure", () => {
  it("waiver pickups: starter points for the claiming team until the stint ends, and $ value", async () => {
    // 2031: Team 2 re-claimed its own WR w2 in week 4 for $7; he started weeks 4 and 5 for 18 + 19 = 37 points.
    const best = await w.run("pickup.best", { limit: 3 });
    expect(rows(best, "starterPoints", "amount", "starts")[0]).toEqual([1, "Team 2", 37, 7, 2]);
    const value = await w.run("pickup.value", { limit: 1 });
    expect(Number(value.rows[0]?.values.pointsPerDollar)).toBeCloseTo(37 / 7, 3);
    // $ per point treats a claim under one point as one: the $30 claim of a never-started player is the worst.
    const worst = await w.run("pickup.faab-per-point", { limit: 2 });
    expect(rows(worst, "dollarsPerPoint").map((r) => r[2])).toEqual([30, 12]);
  });

  it("loyalty counts consecutive weeks across seasons; with no gaps there is no boomerang", async () => {
    // Every rostered player stayed with his team for all ten weeks of the two seasons.
    const res = await w.run("loyalty.stint", { limit: 30 });
    expect(res.rows[0]?.values).toMatchObject({ weeks: 10, span: "2030 WK 1 - 2031 WK 5" });
    expect(res.rows.filter((r) => r.rank === 1).length).toBe(24);
    expect((await w.run("boomerang.longest")).total).toBe(0);
  });

  it("journeyman counts the distinct franchises a player was rostered by", async () => {
    const res = await w.run("journeyman.career", { limit: 3 });
    expect(Number(res.rows[0]?.values.franchises)).toBeGreaterThanOrEqual(1);
    const season = await w.run("journeyman.season", { limit: 3 });
    expect(season.rows[0]?.values.season).toBeDefined();
  });
});

describe("every additional record runs under the filters it supports", () => {
  const extra = RECORD_CATALOG.filter((d) =>
    /^(luck|median|shouldve|contender|heartbreak|projection|oneman|era|asleep|bye|nfl|season\.(allplay|luck|schedule|top|bottom)|seed|champ|trajectory|draft\.(class|steal|bust|best)|pickup|drop-regret|trade\.(best|lopsided)|journeyman|loyalty|boomerang|auction|rivalry|career\.(shouldve|contender|blunders|close|blowout|top|bottom|asleep)|drought|streak)/.test(
      d.id
    )
  );
  it("covers the whole doc 4.5 list", () => {
    expect(extra.length).toBeGreaterThanOrEqual(55);
  });
  for (const def of extra) {
    it(def.id, async () => {
      for (const q of [
        {},
        { scope: "playoffs" },
        { seasons: "2031", onePer: "season", limit: 5 },
        { weeks: "2-4", median: "exclude", franchise: 1, limit: 200 },
      ]) {
        const res = await w.run(def.id, q);
        expect(res.meta.id).toBe(def.id);
        for (const r of res.rows) expect(Number.isFinite(r.values.value as number)).toBe(true);
      }
    });
  }
});

describe("bye weeks and inactive starters", () => {
  let b: World;
  beforeAll(async () => {
    b = await createWorld();
    await b.db.execute(sql`insert into nfl_game (id, season, week, game_type, home_team, away_team)
                           values ('2030_03_KC_DET', 2030, 3, 'REG', 'DET', 'KC')`);
    // Hand-edit the fixture's 2030 weeks, then re-derive. Team 1 week 1 (a tie, 100-100): starters r1 and w1 both on a
    // bye, so the two dead slots (RB, FLEX) are filled from the bench by x1 alone, who scored 20 + 7 = 27.
    // Team 4 week 5 (lost 90-95 to Team 2): r4 on a bye and w4 inactive; bench x4 scored 18 + 7 = 25, so 90 + 25 beats 95.
    // Team 3 week 4 (won 130-100): r3 on a bye. Even weeks have a 0-point bench, so nothing is lost.
    const ids = b.fixture.seasonIds;
    const edit = async (team: string, week: number, player: string, set: ReturnType<typeof sql>) =>
      b.db.execute(sql`
        update player_week pw set ${set}
        from team_week tw, team_season ts, player p
        where tw.id = pw.team_week_id and ts.id = tw.team_season_id and p.id = pw.player_id
          and ts.name = ${team} and tw.week = ${week} and p.full_name = ${player}
          and ts.league_season_id = ${ids[2030]!}`);
    const bye = sql`nfl_team = 'KC', nfl_game_id = null, points = 0`;
    const inactive = sql`nfl_team = 'KC', nfl_game_id = '2030_03_KC_DET', nfl_status = 'INA', points = 0`;
    await edit("Team 1", 1, "Player r1", bye);
    await edit("Team 1", 1, "Player w1", bye);
    await edit("Team 4", 5, "Player r4", bye);
    await edit("Team 4", 5, "Player w4", inactive);
    await edit("Team 3", 4, "Player r3", bye);
    // a game nflverse has no row for (a cancelled one): the player has no game but did score, so he is not on a bye
    await edit("Team 2", 2, "Player q2", sql`nfl_team = 'KC', nfl_game_id = null`);
    // a bench player on Team 4's week-4 bench scores big: the perfect lineup would have survived the semifinal
    await edit("Team 4", 4, "Player x4", sql`points = 40`);
    // Team 3's week-3 starters all came from one NFL game
    for (const p of ["Player q3", "Player r3", "Player w3"])
      await edit("Team 3", 3, p, sql`nfl_team = 'KC', nfl_game_id = '2030_03_KC_DET'`);
    await deriveSeason(b.db, ids[2030]!);
  });
  afterAll(async () => {
    await b?.close();
  });
  const brows = (res: Awaited<ReturnType<World["run"]>>, ...keys: string[]) =>
    res.rows.map((r) => [r.rank, b.team(res, r), ...keys.map((k) => r.values[k])]);
  const q = { seasons: "2030" };

  it("asleep at the wheel: starters out and the points the bench would have added", async () => {
    const week = await b.run("asleep.week", q);
    expect(brows(week, "week", "deadStarters", "byeStarters", "pointsLost")).toEqual([
      [1, "Team 1", 1, 2, 2, 27],
      [2, "Team 4", 5, 2, 1, 25],
      [3, "Team 3", 4, 1, 1, 0],
    ]);
    const lost = await b.run("asleep.lost-week", q);
    expect(brows(lost, "pointsLost").map((r) => r[2])).toEqual([27, 25]);
    expect(lost.total).toBe(2);
  });

  it("a blunder is a loss that the live bench would have won; careers count them", async () => {
    // Team 1's week 1 was a tie, so only Team 4's week-5 loss counts: 90 + 25 = 115 vs 95.
    const res = await b.run("asleep.blunder", q);
    expect(brows(res, "week", "pointsLost", "flipBy")).toEqual([[1, "Team 4", 5, 25, 20]]);
    const career = await b.run("career.blunders", q);
    expect(career.rows[0] && b.team(career, career.rows[0])).toBe("Team 4");
    expect(career.rows[0]?.values.count).toBe(1);
    const asleep = await b.run("career.asleep", q);
    expect(brows(asleep, "count", "byeStarters", "pointsLost")[0]).toEqual([1, "Team 1", 2, 2, 27]);
  });

  it("bye-week survivor needs two starters on a bye; heaviest counts only wins", async () => {
    const survivor = await b.run("bye.survivor", q);
    expect(brows(survivor, "byeStarters", "points")).toEqual([[1, "Team 1", 2, 100]]);
    const heaviest = await b.run("bye.heaviest", q);
    expect(brows(heaviest, "week", "byeStarters")).toEqual([[1, "Team 3", 4, 1]]);
  });

  it("coulda been a contender: a first playoff loss that a perfect lineup would have survived", async () => {
    // Team 4 lost the week-4 semifinal 110-120 with a bench player on 40: optimal 55 + 40 + 33 = 128 > 120.
    const res = await b.run("contender.eliminated", q);
    expect(brows(res, "week", "left")).toEqual([[1, "Team 4", 4, 18]]);
    const career = await b.run("career.contender", q);
    expect(brows(career, "count", "losses")[0]).toEqual([1, "Team 4", 1, 1]);
    // ...and it is also a should've-won loss. (The week-5 loss no longer is: its dead starters scored 0 in this
    // hand-edited data, so the best lineup is 45 + 25 = 70, below the opponent's 95.)
    const sw = await b.run("shouldve-won", q);
    expect(brows(sw, "week", "left")).toEqual([[1, "Team 4", 4, 18]]);
  });

  it("NFL game stack: starter points from one NFL game", async () => {
    const res = await b.run("nfl.stack", q);
    expect(brows(res, "nflGame", "players", "stackPoints", "share")).toEqual([
      [1, "Team 3", "KC @ DET", 3, 140, 1],
      // the inactive starter was given a game in the edit above, so he forms a one-player stack worth nothing
      [2, "Team 4", "KC @ DET", 1, 0, 0],
    ]);
  });
});
