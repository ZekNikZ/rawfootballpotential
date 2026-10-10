import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorld, type World } from "./helpers";

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
