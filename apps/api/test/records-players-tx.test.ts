import { recordCache, sql, dataVersion, eq } from "@rfp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RECORD_CATALOG, getRecordDef } from "@rfp/core";
import { prewarmLeague } from "../src/records/prewarm";
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
const label = (res: Res, r: Res["rows"][number]) =>
  `${r.values.player ?? ""}|${w.team(res, r)}|${r.values.season ?? ""}`;

describe("player records (roster / starters only / bench only, each highest and lowest)", () => {
  it("highest score by a starter, by anyone on the roster, and by a benched player", async () => {
    const starters = await w.run("player.starter.high", { limit: 6 });
    expect(starters.rows.map((r) => [r.rank, r.values.player, r.values.value])).toEqual([
      [1, "Player q3", 70],
      [2, "Player q1", 65],
      [2, "Player q3", 65],
      [2, "Player q1", 65],
      [2, "Player q3", 65],
      [6, "Player q3", 62.5],
    ]);
    const roster = await w.run("player.roster.high", { limit: 1 });
    expect(roster.rows[0]?.values).toMatchObject({ value: 70, slot: "QB" }); // the roster record shows the slot
    const bench = await w.run("player.bench.high", { limit: 3 });
    expect(bench.rows.map((r) => [r.rank, r.values.player, r.values.value])).toEqual([
      [1, "Player x3", 35],
      [2, "Player x3", 33],
      [3, "Player x3", 32],
    ]);
    expect(bench.params.slots).toEqual(["bench"]); // the slot is the record, not a filter
  });

  it("lowest records exclude zero-point weeks by default, and the user can turn that off", async () => {
    const starters = await w.run("player.starter.low", { limit: 3 });
    expect(starters.params.excludeZero).toBe(true);
    expect(starters.rows.map((r) => [r.rank, r.values.value])).toEqual([
      [1, 12],
      [1, 12],
      [1, 12],
    ]);
    // Bench RBs score 0 on even weeks (20 counted team-weeks): zeroes only appear when asked for.
    const withZero = await w.run("player.bench.low", { excludeZero: "false", limit: 50 });
    expect(withZero.params.excludeZero).toBe(false);
    expect(withZero.rows.filter((r) => r.rank === 1).length).toBe(20);
    expect(withZero.rows[0]?.values.value).toBe(0);
    const bench = await w.run("player.bench.low", { limit: 1 });
    expect(bench.rows[0]?.values).toMatchObject({ player: "Player x2", value: 19 });
    expect((await w.run("player.roster.low", { limit: 1 })).rows[0]?.values.value).toBe(12);
  });

  it("position filter uses that week's position; the slot of a starters/bench record cannot be overridden", async () => {
    const rb = await w.run("player.starter.high", { positions: "RB", limit: 1 });
    expect(rb.rows[0]?.values).toMatchObject({ player: "Player r3", position: "RB", points: 42 });
    const rbRoster = await w.run("player.roster.high", { positions: "RB", limit: 1 });
    expect(rbRoster.rows[0]?.values.value).toBe(42); // bench RBs (x) top out at 35
    const overridden = await w.run("player.bench.high", { slots: "starter", limit: 1 });
    expect(overridden.params.slots).toEqual(["bench"]);
    // the roster record has no slot filter at all
    expect(
      (await w.run("player.roster.high", { slots: "bench", limit: 1 })).params.slots
    ).toBeUndefined();
  });

  it("player season: weeks rostered, summed with the season's scoring; combineTeams sums across teams", async () => {
    const res = await w.run("season.player.high", { limit: 3 });
    expect(res.rows[0]?.values).toMatchObject({
      player: "Player q3",
      season: 2030,
      points: 302.5,
      weeks: 5,
      ppg: 60.5,
    });
    expect(res.rows.map((r) => r.values.points)).toEqual([302.5, 282.5, 275]);
    const bench = await w.run("bench-season.player", { limit: 1 });
    expect(bench.rows[0]?.values).toMatchObject({ player: "Player x3", season: 2030 });
    const combined = await w.run("season.player.high", { combineTeams: true, limit: 1 });
    expect(combined.rows[0]?.refs.teamSeasonIds?.length).toBe(1);
  });

  it("best score that didn't count: byes, eliminated teams and games outside the brackets", async () => {
    const res = await w.run("uncounted.best", { limit: 5 });
    expect(
      res.rows.map((r) => [r.rank, w.team(res, r), r.values.season, r.values.week, r.values.points])
    ).toEqual([
      [1, "Team 6", 2030, 4, 90],
      [2, "Team 5", 2030, 4, 80],
      [3, "Team 6", 2031, 4, 75],
      [4, "Team 5", 2030, 5, 70],
      [4, "Team 5", 2031, 4, 70],
    ]);
    expect(res.rows[0]?.values).toMatchObject({
      why: "Game outside the brackets",
      topPlayer: "Player q6 (45)",
    });
    expect(res.rows[3]?.values.why).toBe("No game");
  });
});

describe("transaction records", () => {
  it("only successful claims count: the failed 15-dollar bid never appears (doc §2)", async () => {
    const res = await w.run("waiver.faab-high");
    expect(res.rows.map((r) => [r.values.player, r.values.amount, w.team(res, r)])).toEqual([
      ["Player nw2", 30, "Team 2"],
      ["Player nw1", 12, "Team 3"],
      ["Player w2", 7, "Team 2"],
    ]);
  });

  it("claims and $ spent count successful waiver claims only; free-agent adds are a different type (doc §2)", async () => {
    const claims = await w.run("season.claims.most", { limit: 3 });
    expect(
      claims.rows.map((r) => [w.team(claims, r), r.values.season, r.values.claims, r.values.spent])
    ).toEqual([
      ["Team 2", 2031, 2, 37],
      ["Team 3", 2030, 1, 12],
      ["Team 1", 2030, 0, 0],
    ]);
    const spent = await w.run("season.faab.most", { limit: 2 });
    expect(spent.rows.map((r) => r.values.value)).toEqual([37, 12]);
    // A transaction's scope is the week it happened in: the 7-dollar reclaim was in playoff week 4.
    const playoffs = await w.run("season.claims.most", { scope: "playoffs", limit: 2 });
    expect(
      playoffs.rows.map((r) => [w.team(playoffs, r), r.values.claims, r.values.spent])
    ).toEqual([
      ["Team 2", 1, 7],
      ["Team 1", 0, 0],
    ]);
  });

  it("trades count for every team in them; fewest ranks the zeros together", async () => {
    const most = await w.run("season.trades.most", { limit: 6 });
    expect(most.rows.map((r) => [r.rank, r.values.trades])).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
      [6, 0],
    ]);
    const fewest = await w.run("season.trades.fewest", { limit: 50 });
    expect(fewest.rows.filter((r) => r.rank === 1).length).toBe(7); // 12 team seasons, 5 traded
  });

  it("largest trade = distinct players; picks and FAAB are extras; broadest = distinct teams", async () => {
    const largest = await w.run("trade.largest");
    expect(
      largest.rows.map((r) => [
        r.rank,
        r.values.players,
        r.values.picks,
        r.values.faab,
        r.values.season,
      ])
    ).toEqual([
      [1, 3, 0, 0, 2031],
      [2, 2, 1, 5, 2030],
    ]);
    expect(largest.rows[0]?.refs.teamSeasonIds?.length).toBe(3);
    const broadest = await w.run("trade.broadest");
    expect(broadest.rows.map((r) => [r.rank, r.values.teamCount])).toEqual([
      [1, 3],
      [2, 2],
    ]);
    // A trade's scope is its week's game type: both trades were in the regular season.
    expect((await w.run("trade.largest", { scope: "playoffs" })).total).toBe(0);
    expect((await w.run("trade.largest", { scope: "regular" })).total).toBe(2);
  });

  it("most moved player counts distinct completed transactions per player (doc §2)", async () => {
    const res = await w.run("moves.player", { limit: 4 });
    // nw1: claimed 2030, free-agent add 2031, dropped in the 2031 reclaim = 3 (the failed 2030 claim is not counted).
    // w2: traded 2030, dropped 2031 week 2, reclaimed 2031 week 4 = 3.
    expect(res.rows.map((r) => [r.rank, r.values.player, r.values.moves])).toEqual([
      [1, "Player w2", 3],
      [1, "Player nw1", 3],
      [3, "Player w1", 1],
      [3, "Player x2", 1],
    ]);
    const only2030 = await w.run("moves.player", { seasons: "2030" });
    expect(only2030.rows.find((r) => r.values.player === "Player nw1")?.values.moves).toBe(1);
  });
});

describe("draft retention (doc §2)", () => {
  it("kept = same team, one continuous stint from the draft to the final week", async () => {
    const res = await w.run("season.retention.high", { limit: 6 });
    expect(res.rows.map((r) => [r.rank, w.team(res, r), r.values.kept, r.values.drafted])).toEqual([
      [1, "Team 1", 3, 3],
      [1, "Team 6", 3, 3],
      [3, "Team 2", 2, 3],
      [3, "Team 3", 2, 3],
      [3, "Team 4", 2, 3],
      [3, "Team 5", 2, 3],
    ]);
    // Team 2 dropped w2 in week 2 and claimed him back in week 4: re-acquiring him does not make him "kept".
    const low = await w.run("season.retention.low", { limit: 1 });
    expect(low.rows[0]?.rank).toBe(1);
    expect(low.rows[0]?.values.retentionPct).toBeCloseTo(2 / 3, 3);
    expect(low.availableFrom).toBe(2031); // only 2031 has a draft
  });
});

describe("career transactions", () => {
  it("trades, waiver claims and dollars per franchise", async () => {
    const res = await w.run("career.claims");
    const t2 = res.rows.find((r) => w.team(res, r) === "Team 2")!;
    expect(t2.values).toMatchObject({ trades: 1, claims: 2, spent: 37 });
  });
});

describe("response cache keyed by data_version (doc §3.1)", () => {
  it("pre-warm runs every record once and a second pass is served entirely from the cache", async () => {
    await w.db.execute(sql`delete from record_cache`);
    const n = await prewarmLeague(w.db, w.leagueId);
    const count = async () =>
      Number(
        (await w.db.execute<{ n: string }>(sql`select count(*) n from record_cache`)).rows[0]?.n
      );
    expect(n).toBe(RECORD_CATALOG.length);
    const rows = await count();
    expect(rows).toBe(RECORD_CATALOG.length);
    await prewarmLeague(w.db, w.leagueId);
    expect(await count()).toBe(rows);
    await w.db.execute(sql`delete from record_cache`);
  });

  it("serves repeat queries from the cache and invalidates when a season's data_version changes", async () => {
    const count = async () =>
      Number(
        (await w.db.execute<{ n: string }>(sql`select count(*) n from record_cache`)).rows[0]?.n
      );
    expect(await count()).toBe(0);
    const a = await runRecord(w.db, w.leagueId, "score.high", { limit: 3 });
    expect(await count()).toBe(1);
    const b = await runRecord(w.db, w.leagueId, "score.high", { limit: 3 });
    expect(b).toEqual(a);
    expect(await count()).toBe(1);
    // different params -> different entry
    await runRecord(w.db, w.leagueId, "score.high", { limit: 4 });
    expect(await count()).toBe(2);
    // a data change in a season the query reads bumps its version and so the key
    await w.db
      .update(dataVersion)
      .set({ version: sql`${dataVersion.version} + 1` })
      .where(eq(dataVersion.leagueSeasonId, w.fixture.seasonIds[2030]!));
    const c = await runRecord(w.db, w.leagueId, "score.high", { limit: 3 });
    expect(c.dataVersion).not.toBe(a.dataVersion);
    expect(await count()).toBe(3);
    // a query that does not read 2030 keeps its cache entry
    const only31 = await runRecord(w.db, w.leagueId, "score.high", { seasons: "2031" });
    await w.db
      .update(dataVersion)
      .set({ version: sql`${dataVersion.version} + 1` })
      .where(eq(dataVersion.leagueSeasonId, w.fixture.seasonIds[2030]!));
    expect((await runRecord(w.db, w.leagueId, "score.high", { seasons: "2031" })).dataVersion).toBe(
      only31.dataVersion
    );
    void recordCache;
    void label;

    // bumping the record's own metric version changes the key (and only that record's)
    const def = getRecordDef("score.high") as { version?: number };
    const before = (await runRecord(w.db, w.leagueId, "score.high", { limit: 3 })).dataVersion;
    const other = (await runRecord(w.db, w.leagueId, "score.low", { limit: 3 })).dataVersion;
    def.version = (def.version ?? 1) + 1;
    try {
      expect((await runRecord(w.db, w.leagueId, "score.high", { limit: 3 })).dataVersion).not.toBe(
        before
      );
      expect((await runRecord(w.db, w.leagueId, "score.low", { limit: 3 })).dataVersion).toBe(
        other
      );
    } finally {
      def.version -= 1;
    }
    expect((await runRecord(w.db, w.leagueId, "score.high", { limit: 3 })).dataVersion).toBe(
      before
    );
  });
});
