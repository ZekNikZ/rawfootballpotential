import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RecordError } from "../src/records/run";
import { createWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w?.close();
});

const rankValues = (res: Awaited<ReturnType<World["run"]>>, key: string) =>
  res.rows.map((r) => [r.rank, r.values[key]]);

describe("column sorting", () => {
  it("sorting the ranked column the other way re-ranks from the other end", async () => {
    const flipped = await w.run("season.pf.high", { sort: "pf", dir: "asc", limit: 50 });
    const alias = await w.run("season.pf.low", { limit: 50 });
    expect(flipped.rows.map((r) => r.values.pf)).toEqual(alias.rows.map((r) => r.values.pf));
    expect(flipped.rows[0]?.rank).toBe(1);
    expect(flipped.rows[0]?.values.pf).toBeLessThanOrEqual(flipped.rows[1]?.values.pf as number);
    expect(flipped.params).toMatchObject({ sort: "pf", dir: "asc" });
  });

  it("sorting another column keeps the record's own ranks", async () => {
    const native = await w.run("season.pf.high", { limit: 50 });
    const byPa = await w.run("season.pf.high", { sort: "pa", dir: "desc", limit: 50 });
    const pas = byPa.rows.map((r) => r.values.pa as number);
    expect(pas).toEqual([...pas].sort((a, b) => b - a));
    // Same rows, and each row keeps the rank it has in the native order.
    const rankOf = (res: typeof native) =>
      new Map(res.rows.map((r) => [`${r.refs.teamSeasonId}`, r.rank]));
    expect(rankOf(byPa)).toEqual(rankOf(native));
    expect(byPa.rows.map((r) => r.rank)).not.toEqual(native.rows.map((r) => r.rank));
  });

  it("orders by text and week columns and pages after sorting", async () => {
    const byPlayer = await w.run("player.roster.high", { sort: "player", dir: "asc", limit: 50 });
    const names = byPlayer.rows.map((r) => String(r.values.player).toLowerCase());
    expect(names).toEqual([...names].sort());
    const byWeek = await w.run("score.high", { sort: "when", dir: "asc", limit: 50 });
    const weeks = byWeek.rows.map(
      (r) => (r.values.season as number) * 100 + (r.values.week as number)
    );
    expect(weeks).toEqual([...weeks].sort((a, b) => a - b));
    const page1 = await w.run("score.high", { sort: "when", dir: "asc", limit: 3, offset: 0 });
    const page2 = await w.run("score.high", { sort: "when", dir: "asc", limit: 3, offset: 3 });
    expect([...page1.rows, ...page2.rows].map((r) => r.refs.teamSeasonId)).toEqual(
      byWeek.rows.slice(0, 6).map((r) => r.refs.teamSeasonId)
    );
  });

  it("drops sort params that equal the default order (shared cache key)", async () => {
    const res = await w.run("season.pf.high", { sort: "pf", dir: "desc" });
    expect(res.params.sort).toBeUndefined();
    expect(res.params.dir).toBeUndefined();
  });

  it("refuses columns that cannot be sorted", async () => {
    await expect(w.run("season.pf.high", { sort: "team" })).rejects.toBeInstanceOf(RecordError);
    await expect(w.run("season.pf.high", { sort: "nope" })).rejects.toMatchObject({ status: 400 });
    await expect(w.run("season.pf.high", { sort: "pf", dir: "up" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("the schedule-swap record picks each team's worst schedule when ranked worst-first", async () => {
    const best = await w.run("season.schedule.best", { limit: 50 });
    const worst = await w.run("season.schedule.best", { sort: "winPct", dir: "asc", limit: 50 });
    expect(rankValues(worst, "winPct")[0]?.[1]).toBeLessThanOrEqual(
      best.rows.at(-1)?.values.winPct as number
    );
  });
});
