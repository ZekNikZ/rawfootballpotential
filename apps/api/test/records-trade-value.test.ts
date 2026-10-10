import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@rfp/db";
import { createWorld, type World } from "./helpers";
import { explainTrades, DYNASTY_NEXT_SEASON_WEIGHT } from "../src/records/engines/trade-valuation";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w?.close();
});

describe("career trade value", () => {
  it("counts every team in a player trade once, and nets sum to zero across the league", async () => {
    const res = await w.run("career.trade-value.total", { limit: 50 });
    // 2030: Team 1 <-> Team 2 (w1 / w2); 2031: Team 3, 4, 5 (w3 / w4 / w5). Pick and FAAB legs are not valued.
    const byTeam = new Map(res.rows.map((r) => [w.team(res, r), r.values]));
    expect([...byTeam.keys()].sort()).toEqual(["Team 1", "Team 2", "Team 3", "Team 4", "Team 5"]);
    for (const v of byTeam.values()) expect(v.trades).toBe(1);
    const sum = res.rows.reduce((s, r) => s + Number(r.values.net), 0);
    expect(Math.abs(sum)).toBeLessThan(0.01);
    for (const r of res.rows) {
      expect(Number(r.values.net)).toBeCloseTo(Number(r.values.gained) - Number(r.values.lost), 2);
    }
  });

  it("the average record needs 3 trades by default; the minimum can be lowered", async () => {
    const strict = await w.run("career.trade-value.avg");
    expect(strict.rows.length).toBe(0);
    const open = await w.run("career.trade-value.avg", { minGames: 1, limit: 50 });
    expect(open.rows.length).toBe(5);
    expect(open.rows.map((r) => r.values.netPerTrade)).toEqual(
      open.rows.map((r) => r.values.net) // one trade each, so the average is the total
    );
  });
});

describe("estimated-value variants", () => {
  it("the trade records run on the rest-of-season values", async () => {
    for (const id of ["trade.best.est", "trade.lopsided.est"]) {
      const res = await w.run(id, { limit: 50 });
      expect(res.total, id).toBeGreaterThan(0);
    }
  });

  it("shows who each side traded with and what it gave", async () => {
    const res = await w.run("trade.best.est", { limit: 50 });
    // 5 sides: 2 in the two-team trade, 3 in the three-team trade; each lists the other teams, not its own
    expect(res.rows.length).toBe(5);
    const partners = res.rows.map((r) => r.refs.teamSeasonIds?.length);
    expect(partners.sort()).toEqual([1, 1, 2, 2, 2]);
    for (const r of res.rows) {
      expect(r.refs.teamSeasonIds).not.toContain(r.refs.teamSeasonId);
      expect(String(r.values.gave).length).toBeGreaterThan(0);
    }
  });
});

describe("rest-of-season production", () => {
  it("scores players nobody rostered from Sleeper's stat lines", async () => {
    const week1 = (
      await w.db.execute<{ points: string }>(sql`
        select pp.points from player_week_points pp join player p on p.id = pp.player_id
        where p.sleeper_id = 'nw1' and pp.week = 1 and pp.league_season_id = ${w.fixture.seasonIds[2031]}`)
    ).rows;
    expect(week1.map((r) => Number(r.points))).toEqual([6]); // fixture: a free agent's line scores 6 (rec x 1)
    const held = (
      await w.db.execute<{ n: string }>(sql`
        select count(*) as n from rec_player_week pw join player p on p.id = pw.player_id
        where p.sleeper_id = 'nw1' and pw.week = 1 and pw.league_season_id = ${w.fixture.seasonIds[2031]}`)
    ).rows[0]?.n;
    expect(Number(held)).toBe(0); // nobody had him that week
  });

  it("values a player by his points from the trade week to the end of the season, wherever he was", async () => {
    const items = await explainTrades({
      db: w.db,
      leagueId: w.leagueId,
      seasonIds: [w.fixture.seasonIds[2030]!, w.fixture.seasonIds[2031]!],
      scope: "all",
    });
    const players = items.filter((i) => i.player);
    expect(players.length).toBeGreaterThan(0);
    for (const it of players) {
      const expected = (
        await w.db.execute<{ v: string | null }>(sql`
          select sum(pp.points) as v from rec_player_points pp
          join player p on p.id = pp.player_id
          where pp.player_id = ${it.playerId} and pp.week >= ${it.week}
            and pp.season = (select year from league_season where id = (select league_season_id from rec_transaction_item where item_id = ${it.itemId}))
            and pp.league_id = ${w.leagueId}`)
      ).rows[0]?.v;
      // the fixture leagues are redraft: no next-season part
      expect(it.value).toBeCloseTo(Number(expected ?? 0), 2);
      // the same value for both sides of the trade, whatever the receiving team did with him
      expect(it.player!.value).toBeCloseTo(it.value, 6);
    }
    expect(DYNASTY_NEXT_SEASON_WEIGHT).toBe(0.5);
  });
});
