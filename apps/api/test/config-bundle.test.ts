import {
  auditLog,
  franchise,
  league,
  leagueSeason,
  leagueThreshold,
  manager,
  managerIdentity,
  override,
  player,
  playerIdMap,
  recordConfig,
  siteConfig,
  teamSeason,
  unmatchedPlayer,
  and,
  asc,
  eq,
  sql,
  type Db,
} from "@rfp/db";
import { configBundle } from "@rfp/core/admin";
import {
  exportConfigBundle,
  importConfigBundle,
  joinOverrideKey,
  splitOverrideKey,
} from "@rfp/ingest";
import { createTempDb, seedFixtureLeagues, type SeededFixture } from "@rfp/ingest/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminWorld, type AdminWorld } from "./admin-helpers";

// The configuration export (Admin -> Site & changelog) and `pnpm ingest import-config`: everything an admin sets by
// hand goes into a file keyed by league slug / season year / source ids, and loads into another database. The target
// database below is seeded after its league_season ids were moved to 100+, so a correction key that leaked a database
// id would point at the wrong season.

let w: AdminWorld;
let ownerCookie: string;
let adminCookie: string;
let target: { db: Db; close: () => Promise<void> };
let targetFixture: SeededFixture;

const seasonId = (y: 2030 | 2031) => w.world.fixture.seasonIds[y]!;

beforeAll(async () => {
  w = await createAdminWorld();
  await w.addUser("owner@example.com", "owner");
  await w.addUser("admin@example.com", "admin");
  ownerCookie = await w.login("owner@example.com");
  adminCookie = await w.login("admin@example.com");

  // Configuration set by hand in the source database.
  const db = w.world.db;
  const [first, second] = await db.select().from(manager).orderBy(asc(manager.id));
  await db
    .update(manager)
    .set({ name: "Renamed Manager", avatar: "https://example.com/a.png" })
    .where(eq(manager.id, first!.id));
  await db.insert(managerIdentity).values({
    managerId: second!.id,
    source: "espn",
    externalUserId: "{SWID-2}",
  });
  await db.insert(recordConfig).values([
    {
      leagueId: w.world.leagueId,
      recordId: "score.high",
      visible: false,
      sortOrder: 3,
      featured: true,
    },
    { leagueId: null, recordId: "blowout", visible: true, sortOrder: 7, featured: false },
  ]);
  await db.insert(leagueThreshold).values({
    leagueId: w.world.leagueId,
    leagueSeasonId: seasonId(2031),
    key: "high_scorer",
    value: 130,
  });
  await db.insert(override).values([
    {
      entity: "team_week",
      entityId: joinOverrideKey(seasonId(2030), "r:1:w:2"),
      field: "points",
      value: 123.4,
      reason: "Stat correction",
    },
    {
      entity: "team_season",
      entityId: joinOverrideKey(seasonId(2031), "r:3"),
      field: "final_place",
      value: 2,
      reason: "Commissioner ruling",
      active: false,
    },
  ]);
  const [team1] = await db
    .select()
    .from(teamSeason)
    .where(
      and(eq(teamSeason.leagueSeasonId, seasonId(2030)), eq(teamSeason.externalRosterId, "1"))
    );
  await db
    .update(franchise)
    .set({ name: "The Dynasty" })
    .where(eq(franchise.id, team1!.franchiseId));
  await db
    .update(leagueSeason)
    .set({ hasDraft: false, lockedFlags: ["hasDraft"] })
    .where(eq(leagueSeason.id, seasonId(2031)));
  await db
    .insert(siteConfig)
    .values({ key: "site", value: { name: "Fixture Football", shortName: "FF" } })
    .onConflictDoUpdate({
      target: siteConfig.key,
      set: { value: { name: "Fixture Football", shortName: "FF" } },
    });
  const [somePlayer] = await db
    .select()
    .from(player)
    .where(sql`${player.sleeperId} is not null`)
    .limit(1);
  await db.insert(playerIdMap).values({
    playerId: somePlayer!.id,
    espnId: "ESPN-LINK-1",
    name: "Linked Player",
    manual: true,
  });
  await db.insert(unmatchedPlayer).values({
    source: "espn",
    externalId: "ESPN-IGNORED-1",
    name: "Ignored Player",
    status: "ignored",
  });

  // The target: a fresh database whose league_season ids start at 101.
  const temp = await createTempDb();
  await temp.db.execute(sql`select setval(pg_get_serial_sequence('league_season', 'id'), 100)`);
  targetFixture = await seedFixtureLeagues(temp.db);
  target = temp;
});
afterAll(async () => {
  targetFixture?.restore();
  await target?.close();
  await w?.close();
});

describe("override keys", () => {
  it("turns a league season id into a league and year and back", () => {
    const seasons = new Map([[12, { league: "redraft", year: 2024 }]]);
    expect(splitOverrideKey("ls:12:r:3:w:5", seasons)).toEqual({
      league: "redraft",
      year: 2024,
      rest: "r:3:w:5",
    });
    expect(splitOverrideKey("ls:99:r:3", seasons)).toBeNull();
    expect(splitOverrideKey("something-else", seasons)).toBeNull();
    expect(joinOverrideKey(7, "x:abc:def")).toBe("ls:7:x:abc:def");
  });
});

describe("the export", () => {
  it("holds the hand-made configuration, keyed without database ids", async () => {
    const bundle = configBundle.parse(
      JSON.parse(JSON.stringify(await exportConfigBundle(w.world.db)))
    );
    const fx = bundle.leagues.find((l) => l.slug === "fx")!;
    expect(fx.seasons.map((s) => s.year)).toEqual([2030, 2031]);
    expect(fx.seasons.find((s) => s.year === 2031)?.lockedFlags).toEqual({ hasDraft: false });
    expect(fx.thresholds).toEqual(
      expect.arrayContaining([
        { year: null, key: "high_scorer", value: 125 },
        { year: 2031, key: "high_scorer", value: 130 },
      ])
    );
    expect(fx.franchises.find((f) => f.name === "The Dynasty")?.teamSeasons).toEqual([
      { year: 2030, roster: "1" },
      { year: 2031, roster: "1" },
    ]);
    expect(bundle.managers.find((m) => m.name === "Renamed Manager")?.avatar).toBe(
      "https://example.com/a.png"
    );
    expect(bundle.overrides.map((o) => [o.entity, o.target, o.active])).toEqual([
      ["team_week", { league: "fx", year: 2030, rest: "r:1:w:2" }, true],
      ["team_season", { league: "fx", year: 2031, rest: "r:3" }, false],
    ]);
    expect(bundle.recordConfig).toEqual(
      expect.arrayContaining([
        { league: "fx", recordId: "score.high", visible: false, sortOrder: 3, featured: true },
        { league: null, recordId: "blowout", visible: true, sortOrder: 7, featured: false },
      ])
    );
    expect(bundle.unmatchedPlayers).toHaveLength(1);
    expect(bundle.playerLinks[0]).toMatchObject({ espnId: "ESPN-LINK-1", name: "Linked Player" });
    // No database id leaks into the file.
    expect(JSON.stringify(bundle)).not.toContain(`ls:${seasonId(2030)}:`);
  });

  it("never contains accounts, sessions or secrets", async () => {
    const text = JSON.stringify(await exportConfigBundle(w.world.db));
    for (const secret of ["owner@example.com", "admin@example.com", "password", "session", "token"])
      expect(text.toLowerCase(), secret).not.toContain(secret);
  });
});

describe("GET /api/admin/config-export", () => {
  it("needs a session and the owner role, downloads as a file, and is audited", async () => {
    expect((await w.call("GET", "/api/admin/config-export")).status).toBe(401);
    expect((await w.call("GET", "/api/admin/config-export", { cookie: adminCookie })).status).toBe(
      403
    );
    const before = await w.world.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "config.export"));
    const res = await w.call("GET", "/api/admin/config-export", { cookie: ownerCookie });
    expect(res.status).toBe(200);
    expect(String(res.headers["content-disposition"])).toMatch(
      /^attachment; filename="rfp-config-\d{4}-\d{2}-\d{2}\.json"$/
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(configBundle.safeParse(res.json).success).toBe(true);
    const after = await w.world.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "config.export"));
    expect(after.length).toBe(before.length + 1);
  });
});

describe("the import", () => {
  it("loads the configuration into another database, remapping corrections to its own season ids", async () => {
    expect(targetFixture.seasonIds[2030]).toBeGreaterThan(100);
    const bundle = configBundle.parse(
      JSON.parse(JSON.stringify(await exportConfigBundle(w.world.db)))
    );
    const report = await importConfigBundle(target.db, bundle);
    expect(report.changed).toMatchObject({
      "record settings": 2,
      thresholds: 1,
      corrections: 2,
      "player links": 1,
      "unmatched players": 1,
    });

    const db = target.db;
    const names = (await db.select().from(manager)).map((m) => m.name);
    expect(names).toContain("Renamed Manager");
    const [lg] = await db.select().from(league).where(eq(league.slug, "fx"));
    expect(
      await db.select().from(recordConfig).where(eq(recordConfig.leagueId, lg!.id))
    ).toMatchObject([{ recordId: "score.high", visible: false, sortOrder: 3, featured: true }]);
    expect(
      (await db.select().from(leagueThreshold).where(eq(leagueThreshold.key, "high_scorer"))).map(
        (t) => [t.leagueSeasonId, t.value]
      )
    ).toEqual(
      expect.arrayContaining([
        [null, 125],
        [targetFixture.seasonIds[2031], 130],
      ])
    );
    const [s2031] = await db
      .select()
      .from(leagueSeason)
      .where(eq(leagueSeason.id, targetFixture.seasonIds[2031]!));
    expect(s2031).toMatchObject({ hasDraft: false, lockedFlags: ["hasDraft"] });

    const corrections = await db.select().from(override).orderBy(asc(override.id));
    expect(corrections.map((o) => [o.entity, o.entityId, o.field, o.value, o.active])).toEqual([
      ["team_week", `ls:${targetFixture.seasonIds[2030]}:r:1:w:2`, "points", 123.4, true],
      ["team_season", `ls:${targetFixture.seasonIds[2031]}:r:3`, "final_place", 2, false],
    ]);

    const [team1] = await db
      .select()
      .from(teamSeason)
      .where(
        and(
          eq(teamSeason.leagueSeasonId, targetFixture.seasonIds[2030]!),
          eq(teamSeason.externalRosterId, "1")
        )
      );
    const [f] = await db.select().from(franchise).where(eq(franchise.id, team1!.franchiseId));
    expect(f?.name).toBe("The Dynasty");

    const [site] = await db.select().from(siteConfig).where(eq(siteConfig.key, "site"));
    expect(site?.value).toEqual({ name: "Fixture Football", shortName: "FF" });
    const [link] = await db.select().from(playerIdMap).where(eq(playerIdMap.espnId, "ESPN-LINK-1"));
    expect(link).toMatchObject({ manual: true });
    expect(link?.playerId).not.toBeNull();
  });

  it("is idempotent: a second import changes nothing", async () => {
    const bundle = configBundle.parse(
      JSON.parse(JSON.stringify(await exportConfigBundle(w.world.db)))
    );
    const report = await importConfigBundle(target.db, bundle);
    expect(report.changed).toEqual({});
  });

  it("a dry run reports what would change and writes nothing", async () => {
    const bundle = configBundle.parse(
      JSON.parse(JSON.stringify(await exportConfigBundle(w.world.db)))
    );
    bundle.managers[0]!.name = "Never Saved";
    const report = await importConfigBundle(target.db, bundle, { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.changed.managers).toBe(1);
    expect((await target.db.select().from(manager)).map((m) => m.name)).not.toContain(
      "Never Saved"
    );
  });

  it("merges accounts the file says are one person, and reports what it cannot apply yet", async () => {
    const bundle = configBundle.parse(
      JSON.parse(JSON.stringify(await exportConfigBundle(w.world.db)))
    );
    // Two managers the target has as separate people become one.
    const [a, b] = bundle.managers;
    a!.identities.push(...b!.identities);
    bundle.managers.splice(1, 1);
    // A season and a correction the target does not have.
    const fx = bundle.leagues.find((l) => l.slug === "fx")!;
    fx.seasons.push({
      year: 2040,
      source: "espn",
      externalId: "123",
      enabled: true,
      scoringOverrides: [],
      lockedFlags: {},
    });
    bundle.overrides.push({
      entity: "team_week",
      target: { league: "fx", year: 2040, rest: "r:1:w:1" },
      entityId: null,
      field: "points",
      value: 1,
      reason: "no such season",
      active: true,
      createdAt: new Date().toISOString(),
    });
    const before = (await target.db.select().from(manager)).length;
    const report = await importConfigBundle(target.db, bundle);
    expect(report.changed["managers merged"]).toBe(1);
    expect((await target.db.select().from(manager)).length).toBe(before - 1);
    expect(report.notes.join("\n")).toContain("fx 2040: an ESPN season");
    expect(report.notes.join("\n")).toContain("correction on fx 2040");
  });
});
