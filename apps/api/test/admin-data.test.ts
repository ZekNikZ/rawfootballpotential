import { gzipSync } from "node:zlib";
import {
  auditLog,
  dataVersion,
  league,
  leagueSeason,
  manager,
  managerIdentity,
  override,
  player,
  rawPayload,
  teamSeason,
  unmatchedPlayer,
  and,
  eq,
  sql,
} from "@rfp/db";
import { createHandlers, jobPayload, syncSleeperSeason, deriveSeason } from "@rfp/ingest/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminWorld, ORIGIN, type AdminWorld } from "./admin-helpers";

let w: AdminWorld;
let cookie: string;
let seasonId: number;
let handlers: ReturnType<typeof createHandlers>;

beforeAll(async () => {
  w = await createAdminWorld();
  await w.addUser("owner@example.com", "owner");
  cookie = await w.login("owner@example.com");
  seasonId = w.world.fixture.seasonIds[2030]!;
  handlers = createHandlers({ db: w.world.db, client: w.world.fixture.client });
});
afterAll(async () => {
  await w?.close();
});

const db = () => w.world.db;
const post = (url: string, body: unknown) => w.call("POST", url, { cookie, body });

/** Runs every job the API queued since the last call, the way the ingest worker would. */
async function runQueuedJobs() {
  const jobs = w.sent.splice(0);
  for (const j of jobs) {
    const handler = handlers[j.name as keyof typeof handlers];
    if (handler) await handler(jobPayload.parse(j.data));
  }
  return jobs;
}

/** The ingest the daily/finalize jobs perform: fetch everything again (ignoring the cache) and derive. */
async function reingest() {
  await syncSleeperSeason(db(), w.world.fixture.client, seasonId, { mode: "full", force: true });
  await deriveSeason(db(), seasonId);
}

const teamRow = async (roster: string) =>
  (
    await db()
      .select()
      .from(teamSeason)
      .where(and(eq(teamSeason.leagueSeasonId, seasonId), eq(teamSeason.externalRosterId, roster)))
  )[0]!;

const weekPoints = async (teamSeasonId: number, week: number) =>
  (
    await db().execute<{ points: number; overridden: boolean; counts: boolean }>(
      sql`select points::float8 as points, points_overridden as overridden, counts from team_week
          where team_season_id = ${teamSeasonId} and week = ${week}`
    )
  ).rows[0]!;

describe("corrections survive a re-ingest", () => {
  it("score override: applied by the recompute job, kept by a full re-ingest, removed when deactivated", async () => {
    const t = await teamRow("1");
    const before = await weekPoints(t.id, 2);

    const noReason = await post("/api/admin/overrides", {
      kind: "score",
      teamSeasonId: t.id,
      week: 2,
      points: 250.5,
    });
    expect(noReason.status).toBe(400);

    const created = await post("/api/admin/overrides", {
      kind: "score",
      teamSeasonId: t.id,
      week: 2,
      points: 250.5,
      reason: "Commissioner awarded a stat correction",
    });
    expect(created.status).toBe(201);
    const jobs = await runQueuedJobs();
    expect(jobs).toEqual([
      {
        name: "recompute",
        data: expect.objectContaining({ leagueSeasonId: seasonId, renormalize: true }),
      },
    ]);

    expect(await weekPoints(t.id, 2)).toMatchObject({ points: 250.5, overridden: true });
    const top = await w.world.run("score.high", { limit: 1 });
    expect(top.rows[0]?.values.points).toBe(250.5);

    await reingest();
    expect(await weekPoints(t.id, 2)).toMatchObject({ points: 250.5, overridden: true });
    await runQueuedJobs();

    // A second override on the same game replaces the first (only one is active).
    const second = await post("/api/admin/overrides", {
      kind: "score",
      teamSeasonId: t.id,
      week: 2,
      points: 111,
      reason: "Corrected the correction",
    });
    expect(second.status).toBe(201);
    await runQueuedJobs();
    expect(await weekPoints(t.id, 2)).toMatchObject({ points: 111 });
    const active = await db()
      .select()
      .from(override)
      .where(and(eq(override.field, "points"), eq(override.active, true)));
    expect(active).toHaveLength(1);

    const off = await w.call("DELETE", `/api/admin/overrides/${second.json.id}`, {
      cookie,
      body: { reason: "No longer needed" },
    });
    expect(off.status).toBe(200);
    await runQueuedJobs();
    await reingest();
    expect(await weekPoints(t.id, 2)).toMatchObject({ points: before.points });
    expect((await weekPoints(t.id, 2)).overridden).toBe(before.overridden);
  });

  it("placement override: wins over the bracket result and survives re-derive", async () => {
    const t = await teamRow("6");
    const bracket = t.finalPlace;
    const place = bracket === 5 ? 4 : 5;
    const res = await post("/api/admin/overrides", {
      kind: "placement",
      teamSeasonId: t.id,
      place,
      reason: "League ruling on the final standings",
    });
    expect(res.status).toBe(201);
    const jobs = await runQueuedJobs();
    expect(jobs[0]?.data.renormalize).toBe(false);
    const read = async () =>
      (
        await db()
          .select({ p: teamSeason.finalPlace })
          .from(teamSeason)
          .where(eq(teamSeason.id, t.id))
      )[0]!.p;
    expect(await read()).toBe(place);
    await reingest();
    expect(await read()).toBe(place);
    await w.call("DELETE", `/api/admin/overrides/${res.json.id}`, {
      cookie,
      body: { reason: "Reverting" },
    });
    await runQueuedJobs();
    expect(await read()).toBe(bracket);
  });

  it("game-type override: a game can be taken out of the records, and put back", async () => {
    const [m] = (
      await db().execute<{ week: number; ext: number }>(
        sql`select week, external_matchup_id as ext from matchup
            where league_season_id = ${seasonId} and game_type = 'regular' order by week, id limit 1`
      )
    ).rows;
    const sides = async () =>
      (
        await db().execute<{ counts: boolean; n: number }>(
          sql`select tw.counts, (select count(*)::int from game_result gr where gr.league_season_id = tw.league_season_id and gr.week = tw.week and gr.team_season_id = tw.team_season_id and gr.kind = 'h2h') as n
              from team_week tw join matchup mt on mt.id = tw.matchup_id
              where mt.league_season_id = ${seasonId} and mt.week = ${m!.week} and mt.external_matchup_id = ${m!.ext}`
        )
      ).rows;
    expect((await sides()).every((s) => s.counts && s.n === 1)).toBe(true);

    const res = await post("/api/admin/overrides", {
      kind: "game_type",
      leagueSeasonId: seasonId,
      week: m!.week,
      externalMatchupId: m!.ext,
      gameType: "none",
      reason: "Game was voided",
    });
    expect(res.status).toBe(201);
    await runQueuedJobs();
    expect((await sides()).every((s) => !s.counts && s.n === 0)).toBe(true);
    await reingest();
    expect((await sides()).every((s) => !s.counts && s.n === 0)).toBe(true);

    await w.call("DELETE", `/api/admin/overrides/${res.json.id}`, {
      cookie,
      body: { reason: "Reverting" },
    });
    await runQueuedJobs();
    expect((await sides()).every((s) => s.counts && s.n === 1)).toBe(true);
  });

  it("score and game-type corrections are refused for ESPN seasons; placements are allowed", async () => {
    const [lg] = await db().select().from(league).limit(1);
    const [season] = await db()
      .insert(leagueSeason)
      .values({
        leagueId: lg!.id,
        year: 2019,
        source: "espn",
        externalId: "424242",
        status: "complete",
        regularSeasonWeeks: 13,
        playoffWeekStart: 14,
        lastWeek: 16,
        playoffTeams: 4,
        teamCount: 2,
      })
      .returning();
    const [ts] = await db()
      .insert(teamSeason)
      .values({
        leagueSeasonId: season!.id,
        franchiseId: (await teamRow("1")).franchiseId,
        externalRosterId: "1",
        name: "Old Team",
      })
      .returning();
    const score = await post("/api/admin/overrides", {
      kind: "score",
      teamSeasonId: ts!.id,
      week: 3,
      points: 100,
      reason: "Correction",
    });
    expect(score.status).toBe(400);
    expect(score.json.error).toMatch(/Sleeper/);
    const place = await post("/api/admin/overrides", {
      kind: "placement",
      teamSeasonId: ts!.id,
      place: 2,
      reason: "From the league records",
    });
    expect(place.status).toBe(201);
    w.sent.splice(0);
  });
});

describe("configuration endpoints", () => {
  it("season data flags can be locked against ingest, and unlocked again", async () => {
    const before = (
      await db().select().from(dataVersion).where(eq(dataVersion.leagueSeasonId, seasonId))
    )[0]!;
    const res = await w.call("PATCH", `/api/admin/seasons/${seasonId}`, {
      cookie,
      body: { flags: { hasProjections: true, hasDraft: false } },
    });
    expect(res.status).toBe(200);
    expect(res.json.lockedFlags.sort()).toEqual(["hasDraft", "hasProjections"]);
    expect(res.json).toMatchObject({ hasProjections: true, hasDraft: false });
    const after = (
      await db().select().from(dataVersion).where(eq(dataVersion.leagueSeasonId, seasonId))
    )[0]!;
    expect(after.version).toBeGreaterThan(before.version);

    // A re-sync must not overwrite a locked flag.
    await reingest();
    const [s] = await db().select().from(leagueSeason).where(eq(leagueSeason.id, seasonId));
    expect(s).toMatchObject({ hasProjections: true, hasDraft: false });

    const unlock = await w.call("PATCH", `/api/admin/seasons/${seasonId}`, {
      cookie,
      body: { flags: { hasProjections: null, hasDraft: null } },
    });
    expect(unlock.json.lockedFlags).toEqual([]);
  });

  it("changing as-played scoring queues a re-normalize", async () => {
    const res = await w.call("PATCH", `/api/admin/seasons/${seasonId}`, {
      cookie,
      body: { scoringOverrides: [{ stat: "pass_int", points: -1, toWeek: 1 }] },
    });
    expect(res.status).toBe(200);
    expect(w.sent.splice(0)).toEqual([
      { name: "recompute", data: expect.objectContaining({ renormalize: true }) },
    ]);
    await w.call("PATCH", `/api/admin/seasons/${seasonId}`, {
      cookie,
      body: { scoringOverrides: [] },
    });
    w.sent.splice(0);
  });

  it("adding a season queues an ingest job; an unknown source is refused", async () => {
    const [lg] = await db().select().from(league).limit(1);
    const dup = await post("/api/admin/seasons", {
      leagueId: lg!.id,
      source: "sleeper",
      externalId: "4242424242",
    });
    expect(dup.status).toBe(202);
    expect(w.sent.splice(0)).toEqual([
      {
        name: "add-season",
        data: expect.objectContaining({ leagueId: lg!.id, externalId: "4242424242" }),
      },
    ]);
    const espn = await post("/api/admin/seasons", {
      leagueId: lg!.id,
      source: "espn",
      externalId: "123456",
    });
    expect(espn.status).toBe(400);
  });

  it("thresholds: set, recompute queued, and the trophies follow", async () => {
    const [lg] = await db().select().from(league).limit(1);
    const res = await w.call("PUT", "/api/admin/thresholds", {
      cookie,
      body: { leagueId: lg!.id, leagueSeasonId: null, key: "high_scorer", value: 135 },
    });
    expect(res.status).toBe(200);
    const jobs = await runQueuedJobs();
    expect(jobs.length).toBeGreaterThan(0);
    const list = await w.call("GET", `/api/admin/thresholds?leagueId=${lg!.id}`, { cookie });
    expect(
      list.json.thresholds.filter((t: { key: string }) => t.key === "high_scorer")
    ).toHaveLength(1);
    const trophies = await w.app.inject({
      method: "GET",
      url: `/api/leagues/${lg!.slug}/trophies`,
    });
    const club = trophies
      .json()
      .trophies.filter((t: { type: string }) => t.type === "high-scorer-club");
    expect(club.every((t: { value: number }) => t.value > 135)).toBe(true);
    // Put it back so later tests see the fixture values.
    await w.call("PUT", "/api/admin/thresholds", {
      cookie,
      body: { leagueId: lg!.id, leagueSeasonId: null, key: "high_scorer", value: 125 },
    });
    await runQueuedJobs();
  });

  it("managers: rename, identities, and merging a duplicate moves everything over", async () => {
    const [a, b] = await db().select().from(manager).orderBy(manager.id).limit(2);
    const rename = await w.call("PATCH", `/api/admin/managers/${a!.id}`, {
      cookie,
      body: { name: "Renamed Manager" },
    });
    expect(rename.json.name).toBe("Renamed Manager");

    const [dupIdentity] = await db()
      .select()
      .from(managerIdentity)
      .where(eq(managerIdentity.managerId, b!.id));
    const merged = await post("/api/admin/managers/merge", { fromId: b!.id, intoId: a!.id });
    expect(merged.status).toBe(200);
    expect(merged.json.identities).toBeGreaterThan(0);
    const [moved] = await db()
      .select()
      .from(managerIdentity)
      .where(eq(managerIdentity.id, dupIdentity!.id));
    expect(moved?.managerId).toBe(a!.id);
    expect(await db().select().from(manager).where(eq(manager.id, b!.id))).toHaveLength(0);

    const records = await w.world.run("career.wins");
    const names = Object.values(records.entities.managers).map((m) => m.name);
    expect(names).toContain("Renamed Manager");

    const same = await post("/api/admin/managers/merge", { fromId: a!.id, intoId: a!.id });
    expect(same.status).toBe(400);
  });

  it("franchise mapping: refuses a franchise that already has a team that season", async () => {
    const t1 = await teamRow("1");
    const t2 = await teamRow("2");
    const res = await w.call("PATCH", `/api/admin/team-seasons/${t1.id}`, {
      cookie,
      body: { franchiseId: t2.franchiseId },
    });
    expect(res.status).toBe(409);
  });

  it("record settings hide, reorder and feature records on the public catalog", async () => {
    const [lg] = await db().select().from(league).limit(1);
    const catalog = async () =>
      (await w.app.inject({ method: "GET", url: `/api/leagues/${lg!.slug}/records` })).json()
        .records;
    const base = await catalog();
    expect(base.some((r: { id: string }) => r.id === "score.high")).toBe(true);

    const hide = await w.call("PUT", "/api/admin/records", {
      cookie,
      body: {
        leagueId: null,
        recordId: "score.high",
        visible: false,
        sortOrder: 0,
        featured: false,
      },
    });
    expect(hide.status).toBe(200);
    expect((await catalog()).some((r: { id: string }) => r.id === "score.high")).toBe(false);

    // A league-specific setting beats the global one.
    await w.call("PUT", "/api/admin/records", {
      cookie,
      body: {
        leagueId: lg!.id,
        recordId: "score.high",
        visible: true,
        sortOrder: 5,
        featured: true,
      },
    });
    const shown = await catalog();
    expect(shown[0]).toMatchObject({ id: "score.high", featured: true });

    const rows = (await w.call("GET", "/api/admin/records", { cookie })).json.config;
    for (const r of rows) await w.call("DELETE", `/api/admin/records/${r.id}`, { cookie });
    expect((await catalog()).map((r: { id: string }) => r.id)).toEqual(
      base.map((r: { id: string }) => r.id)
    );
    const unknown = await w.call("PUT", "/api/admin/records", {
      cookie,
      body: { leagueId: null, recordId: "nope", visible: false, sortOrder: 0, featured: false },
    });
    expect(unknown.status).toBe(400);
  });
});

describe("players, jobs and import", () => {
  it("unmatched players can be mapped (which teaches the id) or ignored", async () => {
    const [p] = await db().select().from(player).limit(1);
    const [u1, u2] = await db()
      .insert(unmatchedPlayer)
      .values([
        { source: "espn", externalId: "99001", name: "Mystery Man" },
        { source: "espn", externalId: "99002", name: "Other Man" },
      ])
      .returning();
    const open = await w.call("GET", "/api/admin/players/unmatched", { cookie });
    expect(open.json.unmatched.length).toBeGreaterThanOrEqual(2);

    const search = await w.call(
      "GET",
      `/api/admin/players/search?q=${encodeURIComponent(p!.fullName.slice(0, 3))}`,
      { cookie }
    );
    expect(search.json.players.length).toBeGreaterThan(0);

    const mapped = await post(`/api/admin/players/unmatched/${u1!.id}/map`, { playerId: p!.id });
    expect(mapped.status).toBe(200);
    const [after] = await db().select().from(player).where(eq(player.id, p!.id));
    expect(after?.espnId).toBe("99001");
    const [row] = await db().select().from(unmatchedPlayer).where(eq(unmatchedPlayer.id, u1!.id));
    expect(row).toMatchObject({ status: "mapped", resolvedPlayerId: p!.id });

    expect((await post(`/api/admin/players/unmatched/${u2!.id}/ignore`, {})).status).toBe(200);
    const left = await w.call("GET", "/api/admin/players/unmatched", { cookie });
    expect(left.json.unmatched.some((x: { id: number }) => x.id === u2!.id)).toBe(false);
  });

  it("triggers jobs under the admin's name and lists the run history", async () => {
    const res = await post("/api/admin/jobs/finalize", { leagueSeasonId: seasonId });
    expect(res.status).toBe(202);
    const [sent] = w.sent.splice(0);
    expect(sent).toMatchObject({ name: "finalize", data: { leagueSeasonId: seasonId } });
    expect(typeof sent!.data.triggeredBy).toBe("string");
    expect((await post("/api/admin/jobs/not-a-job", {})).status).toBe(404);
    expect((await post("/api/admin/jobs/live", { leagueSeasonId: 999999 })).status).toBe(404);

    await handlers.recompute(jobPayload.parse({ leagueSeasonId: seasonId, triggeredBy: "tester" }));
    const runs = await w.call("GET", "/api/admin/jobs/runs?kind=recompute", { cookie });
    expect(runs.json.runs[0]).toMatchObject({
      kind: "recompute",
      status: "success",
      triggeredBy: "tester",
    });
  });

  const multipart = (name: string, content: Buffer) => {
    const boundary = "----rfp-test-boundary";
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/gzip\r\n\r\n`;
    return {
      payload: Buffer.concat([Buffer.from(head), content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
      type: `multipart/form-data; boundary=${boundary}`,
    };
  };
  const upload = async (bundle: unknown, gz = true) => {
    const raw = Buffer.from(JSON.stringify(bundle));
    const { payload, type } = multipart("bundle.json.gz", gz ? gzipSync(raw) : raw);
    const res = await w.app.inject({
      method: "POST",
      url: "/api/admin/import/espn",
      headers: { cookie, origin: ORIGIN, "content-type": type },
      payload,
    });
    return { status: res.statusCode, json: res.json() };
  };

  it("archives an ESPN bundle in raw_payload and queues the import", async () => {
    w.sent.splice(0);
    const [lg] = await db().select().from(league).limit(1);
    const bundle = {
      manifest: {
        format: 1,
        league: lg!.slug,
        year: 2019,
        espnLeagueId: "424242",
        scrapedAt: "2026-10-01T12:00:00.000Z",
      },
      responses: [
        {
          endpoint: "/apis/v3/games/ffl/seasons/2019/segments/0/leagues/424242",
          params: { view: "mTeam" },
          payload: { id: 424242 },
        },
        {
          endpoint: "/apis/v3/games/ffl/seasons/2019/segments/0/leagues/424242",
          params: { view: "mMatchup", week: 1 },
          payload: { schedule: [] },
        },
      ],
    };
    const ok = await upload(bundle);
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ responses: 2, normalized: true });
    const stored = await db().select().from(rawPayload).where(eq(rawPayload.source, "espn"));
    expect(stored).toHaveLength(2);
    expect(stored[0]?.bundle).toContain("2019");
    // The worker does the normalizing and records its own run: the route only queues it.
    expect(w.sent.splice(0)).toEqual([
      {
        name: "import-espn",
        data: { leagueSeasonId: ok.json.leagueSeasonId, triggeredBy: expect.any(String) },
      },
    ]);

    // plain (not gzipped) JSON works too
    expect((await upload(bundle, false)).status).toBe(200);
  });

  it("refuses a bundle that is malformed or for a season we don't have", async () => {
    const [lg] = await db().select().from(league).limit(1);
    const manifest = {
      format: 1,
      league: lg!.slug,
      year: 2019,
      espnLeagueId: "424242",
      scrapedAt: "2026-10-01T12:00:00.000Z",
    };
    const resp = [{ endpoint: "/x", payload: {} }];
    expect((await upload({ manifest, responses: [] })).status).toBe(400);
    expect((await upload({ manifest: { ...manifest, year: 2010 }, responses: resp })).status).toBe(
      404
    );
    expect(
      (await upload({ manifest: { ...manifest, espnLeagueId: "1" }, responses: resp })).status
    ).toBe(400);
    expect((await upload({ nope: true })).status).toBe(400);
  });
});

describe("every change is audited", () => {
  it("has an audit entry (who, what, before / after) for the writes above", async () => {
    const rows = await db().select().from(auditLog);
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      "override.create",
      "override.deactivate",
      "season.update",
      "season.add",
      "threshold.set",
      "manager.update",
      "manager.merge",
      "record.config",
      "player.map",
      "job.trigger",
      "import.espn",
    ])
      expect(actions.has(a), a).toBe(true);
    const created = rows.find((r) => r.action === "override.create")!;
    expect(created.userId).toBeTruthy();
    expect(created.after).toMatchObject({ reason: expect.any(String) });
  });
});
