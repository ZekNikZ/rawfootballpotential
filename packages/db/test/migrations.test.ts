import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "../src/client";
import { runMigrations } from "../src/migrate";
import * as s from "../src/schema";
import { createTempDatabase } from "./helpers";

let url: string;
let drop: () => Promise<void>;
let db: Db;
let end: () => Promise<void>;

beforeAll(async () => {
  ({ url, drop } = await createTempDatabase());
  await runMigrations(url);
  const c = createDb(url, { max: 2 });
  db = c.db;
  end = () => c.pool.end();
});

afterAll(async () => {
  await end?.();
  await drop?.();
});

const count = async (query: string) => {
  const r = await db.execute<{ n: string }>(sql.raw(query));
  return Number(r.rows[0]?.n);
};

describe("migrations", () => {
  it("apply to an empty database and re-running is a no-op", async () => {
    const before = await count("select count(*) n from drizzle.__drizzle_migrations");
    await runMigrations(url);
    expect(await count("select count(*) n from drizzle.__drizzle_migrations")).toBe(before);
    expect(
      await count(
        "select count(*) n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
      )
    ).toBeGreaterThan(40);
    expect(
      await count(
        "select count(*) n from information_schema.views where table_schema='public' and table_name ~ '^rec_'"
      )
    ).toBe(9);
  });

  it("rec views expose only completed weeks and counted rows", async () => {
    const [lg] = await db
      .insert(s.league)
      .values({ slug: "t", name: "T", type: "redraft" })
      .returning();
    const [season] = await db
      .insert(s.leagueSeason)
      .values({
        leagueId: lg!.id,
        year: 2024,
        source: "sleeper",
        externalId: "x1",
        regularSeasonWeeks: 14,
        playoffWeekStart: 15,
        lastWeek: 17,
        playoffTeams: 6,
        teamCount: 2,
      })
      .returning();
    await db.insert(s.leagueSeasonWeek).values([
      { leagueSeasonId: season!.id, week: 1, status: "complete", gameTypeDefault: "regular" },
      { leagueSeasonId: season!.id, week: 2, status: "in_progress", gameTypeDefault: "regular" },
      { leagueSeasonId: season!.id, week: 15, status: "complete", gameTypeDefault: "playoffs" },
    ]);
    const [f1, f2] = await db
      .insert(s.franchise)
      .values([{ leagueId: lg!.id }, { leagueId: lg!.id }])
      .returning();
    const [t1, t2] = await db
      .insert(s.teamSeason)
      .values([
        { leagueSeasonId: season!.id, franchiseId: f1!.id, externalRosterId: "1", name: "A" },
        { leagueSeasonId: season!.id, franchiseId: f2!.id, externalRosterId: "2", name: "B" },
      ])
      .returning();
    const [m1] = await db
      .insert(s.matchup)
      .values({ leagueSeasonId: season!.id, week: 1, externalMatchupId: 1, gameType: "regular" })
      .returning();
    await db.insert(s.teamWeek).values([
      {
        leagueSeasonId: season!.id,
        teamSeasonId: t1!.id,
        week: 1,
        matchupId: m1!.id,
        points: 100,
        isFinal: true,
      },
      {
        leagueSeasonId: season!.id,
        teamSeasonId: t2!.id,
        week: 1,
        matchupId: m1!.id,
        points: 90,
        isFinal: true,
      },
      // in-progress week: must never reach a record
      { leagueSeasonId: season!.id, teamSeasonId: t1!.id, week: 2, points: 55, isFinal: false },
      // complete week, no game: only visible through the *_all view
      {
        leagueSeasonId: season!.id,
        teamSeasonId: t1!.id,
        week: 15,
        counts: false,
        points: 140,
        isFinal: true,
      },
    ]);

    const counted = await db.execute<{ week: number; points: number }>(
      sql`select week, points::float from rec_team_week order by week, points`
    );
    expect(counted.rows.map((r) => [r.week, r.points])).toEqual([
      [1, 90],
      [1, 100],
    ]);
    const all = await db.execute<{ week: number; game_type: string }>(
      sql`select week, game_type from rec_team_week_all order by week, points`
    );
    expect(all.rows.map((r) => [r.week, r.game_type])).toEqual([
      [1, "regular"],
      [1, "regular"],
      [15, "none"],
    ]);
    const mu = await db.execute<{ combined_points: number }>(
      sql`select combined_points::float from rec_matchup`
    );
    expect(mu.rows.map((r) => r.combined_points)).toEqual([190]);
  });
});
