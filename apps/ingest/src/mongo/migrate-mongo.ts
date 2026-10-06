import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  createDb,
  franchise,
  league,
  leagueSeason,
  leagueSeasonWeek,
  leagueThreshold,
  manager,
  managerIdentity,
  matchup,
  override,
  rawPayload,
  siteConfig,
  syncRun,
  teamSeason,
  teamSeasonManager,
  teamWeek,
  type Db,
  and,
  eq,
} from "@rfp/db";
import { MongoClient } from "mongodb";
import { z } from "zod";
import { hashParams } from "../lib/raw-store";
import { log } from "../lib/log";
import { teamSeasonOverrideKey } from "../sleeper/games";
import type { SleeperClient } from "../sleeper/client";
import { bootstrapSleeperSeason } from "../sleeper/sync";

// Shapes of the legacy Mongo documents (legacy/types/data/*). Read-only: this module only calls find().
const legacyConfig = z.object({
  metadata: z.object({ name: z.string(), shortName: z.string() }),
  leagues: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      type: z.enum(["redraft", "dynasty"]),
      color: z.string(),
      years: z.array(
        z.object({
          source: z.enum(["sleeper", "db"]),
          year: z.number(),
          leagueId: z.string(),
          internalId: z.string().optional(),
          finalPlacements: z.record(z.string(), z.number()).optional(),
        })
      ),
    })
  ),
  managers: z.array(
    z.object({ id: z.string(), name: z.string(), sleeperIds: z.array(z.string()) })
  ),
});

const legacyTeam = z.object({
  teamId: z.string(),
  managerId: z.string(),
  name: z.string(),
  division: z.string().optional(),
});
const legacySide = z.object({ teamId: z.string(), points: z.number() });
const legacyLeague = z.object({
  leagueId: z.string(),
  year: z.number(),
  teamData: z.object({
    teams: z.record(z.string(), legacyTeam),
    rosterPositions: z.array(z.string()),
    benchSize: z.number(),
    injuryReserveSize: z.number().optional(),
    playoffQualifiedTeams: z.array(z.string()),
    finalPlacements: z.record(z.string(), z.number()).optional(),
  }),
  matchupData: z.object({
    matchups: z.array(
      z.object({
        week: z.number(),
        team1: legacySide,
        team2: z.union([legacySide, z.literal("BYE"), z.literal("TBD")]),
      })
    ),
    playoffSpots: z.number(),
    playoffWeekStart: z.number(),
    totalWeekCount: z.number(),
    medianEnabled: z.boolean().optional(),
  }),
});

const THRESHOLDS = {
  redraft: { high_scorer: 190, benchwarmer: 65, smartypants: 0.999 },
  dynasty: { high_scorer: 200, benchwarmer: 90, smartypants: 0.999 },
} as const;

export interface MongoMigrationSummary {
  leagues: number;
  managers: number;
  seasons: { sleeper: number; espn: number };
  espnMatchups: number;
  placementOverrides: number;
  projectionsImported: number;
  warnings: string[];
}

export async function migrateFromMongo(
  db: Db,
  sleeper: SleeperClient,
  mongoUrl: string,
  mongoDatabase: string
): Promise<MongoMigrationSummary> {
  const summary: MongoMigrationSummary = {
    leagues: 0,
    managers: 0,
    seasons: { sleeper: 0, espn: 0 },
    espnMatchups: 0,
    placementOverrides: 0,
    projectionsImported: 0,
    warnings: [],
  };
  const mongo = new MongoClient(mongoUrl);
  await mongo.connect();
  try {
    const mdb = mongo.db(mongoDatabase);
    const configDoc = await mdb.collection("config").findOne();
    if (!configDoc) throw new Error("no config document in Mongo");
    const config = legacyConfig.parse(configDoc);

    // ---- site config ----
    await putSiteConfig(db, "site", {
      name: config.metadata.name,
      shortName: config.metadata.shortName,
    });
    const changelog = await loadChangelog();
    if (changelog) await putSiteConfig(db, "changelog", changelog);

    // ---- managers ----
    const managerByLegacy = new Map<string, number>();
    for (const m of config.managers) {
      const legacyIdentity = `legacy:${m.id}`;
      const identities = [
        ...m.sleeperIds.map((id) => ({ source: "sleeper" as const, externalUserId: id })),
        { source: "espn" as const, externalUserId: legacyIdentity },
      ];
      let managerId: number | undefined;
      for (const i of identities) {
        const [hit] = await db
          .select({ managerId: managerIdentity.managerId })
          .from(managerIdentity)
          .where(
            and(
              eq(managerIdentity.source, i.source),
              eq(managerIdentity.externalUserId, i.externalUserId)
            )
          );
        if (hit) {
          managerId = hit.managerId;
          break;
        }
      }
      if (managerId === undefined) {
        const [row] = await db
          .insert(manager)
          .values({ name: m.name })
          .returning({ id: manager.id });
        managerId = row!.id;
      }
      for (const i of identities)
        await db
          .insert(managerIdentity)
          .values({ managerId, ...i })
          .onConflictDoNothing();
      managerByLegacy.set(m.id, managerId);
    }
    summary.managers = managerByLegacy.size;

    // ---- leagues + thresholds ----
    const leagueIdByKey = new Map<string, number>();
    for (const [index, l] of config.leagues.entries()) {
      const values = {
        slug: l.key,
        name: l.name,
        type: l.type,
        color: l.color,
        displayOrder: index,
      };
      const [row] = await db
        .insert(league)
        .values(values)
        .onConflictDoUpdate({ target: league.slug, set: values })
        .returning({ id: league.id });
      leagueIdByKey.set(l.key, row!.id);
      for (const [key, value] of Object.entries(THRESHOLDS[l.type])) {
        await db
          .insert(leagueThreshold)
          .values({ leagueId: row!.id, leagueSeasonId: null, key, value })
          .onConflictDoUpdate({
            target: [leagueThreshold.leagueId, leagueThreshold.leagueSeasonId, leagueThreshold.key],
            set: { value },
          });
      }
    }
    summary.leagues = leagueIdByKey.size;

    // ---- seasons ----
    const espnDocs = new Map<string, z.infer<typeof legacyLeague>>();
    for await (const doc of mdb.collection("leagues").find()) {
      const parsed = legacyLeague.safeParse(doc);
      if (parsed.success) espnDocs.set(parsed.data.leagueId, parsed.data);
      else summary.warnings.push(`skipped unreadable Mongo league ${String(doc.leagueId)}`);
    }

    for (const l of config.leagues) {
      const leagueId = leagueIdByKey.get(l.key)!;
      for (const y of l.years.slice().sort((a, b) => a.year - b.year)) {
        let seasonId: number;
        if (y.source === "sleeper") {
          if (!y.internalId) throw new Error(`${y.leagueId}: Sleeper season without internalId`);
          seasonId = await bootstrapSleeperSeason(db, sleeper, {
            leagueId,
            externalId: y.internalId,
          });
          summary.seasons.sleeper++;
          for (const [legacyTeamId, place] of Object.entries(y.finalPlacements ?? {})) {
            const roster = legacyTeamId.split("-").at(-1)!;
            await putPlacement(db, seasonId, roster, place, false, summary);
          }
        } else {
          const doc = espnDocs.get(y.leagueId);
          if (!doc) {
            summary.warnings.push(`${y.leagueId}: configured as db but not found in Mongo leagues`);
            continue;
          }
          seasonId = await importEspnSeason(db, {
            leagueId,
            l: { name: l.name, type: l.type },
            doc,
            managerByLegacy,
            summary,
          });
          summary.seasons.espn++;
          for (const [legacyTeamId, place] of Object.entries(
            y.finalPlacements ?? doc.teamData.finalPlacements ?? {}
          )) {
            await putPlacement(db, seasonId, legacyTeamId, place, true, summary);
          }
        }
      }
    }

    // ---- cached projections (what the old site displayed) ----
    for await (const p of mdb.collection("projections-cache").find()) {
      const params = { leagueId: String(p.leagueId), year: Number(p.year), week: Number(p.week) };
      const hash = hashParams(params);
      const [existing] = await db
        .select({ id: rawPayload.id })
        .from(rawPayload)
        .where(
          and(
            eq(rawPayload.source, "sleeper"),
            eq(rawPayload.endpoint, "mongo/projections-cache"),
            eq(rawPayload.paramsHash, hash)
          )
        )
        .limit(1);
      if (existing) continue;
      await db.insert(rawPayload).values({
        source: "sleeper",
        endpoint: "mongo/projections-cache",
        params,
        paramsHash: hash,
        payload: { projections: p.projections },
        bundle: "mongo-migration",
      });
      summary.projectionsImported++;
    }
  } finally {
    await mongo.close();
  }
  return summary;
}

async function putSiteConfig(db: Db, key: string, value: unknown) {
  await db
    .insert(siteConfig)
    .values({ key, value })
    .onConflictDoUpdate({ target: siteConfig.key, set: { value, updatedAt: new Date() } });
}

/**
 * Legacy hand-entered placements. For Sleeper seasons the brackets are authoritative (the owner confirmed the
 * hand-entered values had errors), so those are stored inactive for reference; ESPN seasons have no brackets,
 * so theirs stay active.
 */
async function putPlacement(
  db: Db,
  leagueSeasonId: number,
  externalRosterId: string,
  place: number,
  active: boolean,
  summary: MongoMigrationSummary
) {
  const entityId = teamSeasonOverrideKey(leagueSeasonId, externalRosterId);
  const [existing] = await db
    .select({ id: override.id })
    .from(override)
    .where(
      and(
        eq(override.entity, "team_season"),
        eq(override.entityId, entityId),
        eq(override.field, "final_place")
      )
    );
  const row = {
    entity: "team_season",
    entityId,
    field: "final_place",
    value: place,
    reason: active
      ? "Imported from the legacy config (hand-entered; this season has no bracket data)"
      : "Imported from the legacy config (hand-entered; superseded by the bracket results)",
    active,
  };
  if (existing) await db.update(override).set(row).where(eq(override.id, existing.id));
  else await db.insert(override).values(row);
  summary.placementOverrides++;
}

/** The legacy changelog is a TS constant; load it with the runtime loader (tsx) instead of copying it by hand. */
async function loadChangelog(): Promise<unknown | null> {
  try {
    const file = path.resolve(process.cwd(), "../../legacy/utils/changelog.ts");
    const mod = (await import(pathToFileURL(file).href)) as {
      CHANGELOG?: { date: Date | string }[];
    };
    return mod.CHANGELOG?.map((e) => ({ ...e, date: new Date(e.date).toISOString() })) ?? null;
  } catch (err) {
    log.warn({ err: String(err) }, "could not load legacy changelog");
    return null;
  }
}

async function importEspnSeason(
  db: Db,
  input: {
    leagueId: number;
    l: { name: string; type: "redraft" | "dynasty" };
    doc: z.infer<typeof legacyLeague>;
    managerByLegacy: ReadonlyMap<string, number>;
    summary: MongoMigrationSummary;
  }
): Promise<number> {
  const { doc } = input;
  const externalId = `mongo:${doc.leagueId}`;
  await db
    .delete(leagueSeason)
    .where(and(eq(leagueSeason.source, "espn"), eq(leagueSeason.externalId, externalId)));
  const md = doc.matchupData;
  const slots = doc.teamData.rosterPositions.filter((p) => p !== "BN");
  const [season] = await db
    .insert(leagueSeason)
    .values({
      leagueId: input.leagueId,
      year: doc.year,
      source: "espn",
      externalId,
      status: "complete",
      regularSeasonWeeks: md.playoffWeekStart - 1,
      playoffWeekStart: md.playoffWeekStart,
      lastWeek: md.totalWeekCount,
      playoffTeams: md.playoffSpots,
      teamCount: Object.keys(doc.teamData.teams).length,
      medianEnabled: md.medianEnabled ?? false,
      hasLosersBracket: false,
      rosterSlots: slots,
      benchSlots: doc.teamData.benchSize,
      irSlots: doc.teamData.injuryReserveSize ?? 0,
      lastCompletedWeek: md.totalWeekCount,
    })
    .returning({ id: leagueSeason.id });
  const seasonId = season!.id;
  await db.insert(leagueSeasonWeek).values(
    Array.from({ length: md.totalWeekCount }, (_, i) => ({
      leagueSeasonId: seasonId,
      week: i + 1,
      status: "complete" as const,
      gameTypeDefault: i + 1 >= md.playoffWeekStart ? ("playoffs" as const) : ("regular" as const),
      finalizedAt: new Date(),
    }))
  );

  // Redraft: franchise = manager, shared across the league's seasons.
  const existingFranchises = await db
    .selectDistinct({ managerId: teamSeasonManager.managerId, franchiseId: teamSeason.franchiseId })
    .from(teamSeasonManager)
    .innerJoin(teamSeason, eq(teamSeason.id, teamSeasonManager.teamSeasonId))
    .innerJoin(leagueSeason, eq(leagueSeason.id, teamSeason.leagueSeasonId))
    .where(eq(leagueSeason.leagueId, input.leagueId));
  const franchiseByManager = new Map(existingFranchises.map((f) => [f.managerId, f.franchiseId]));

  const teamSeasonByLegacy = new Map<string, number>();
  const qualified = new Set(doc.teamData.playoffQualifiedTeams);
  for (const t of Object.values(doc.teamData.teams)) {
    const managerId = input.managerByLegacy.get(t.managerId);
    if (managerId === undefined) {
      input.summary.warnings.push(`${doc.leagueId}: unknown manager ${t.managerId}`);
      continue;
    }
    let franchiseId = franchiseByManager.get(managerId);
    if (franchiseId === undefined) {
      const [f] = await db
        .insert(franchise)
        .values({ leagueId: input.leagueId })
        .returning({ id: franchise.id });
      franchiseId = f!.id;
      franchiseByManager.set(managerId, franchiseId);
    }
    const [ts] = await db
      .insert(teamSeason)
      .values({
        leagueSeasonId: seasonId,
        franchiseId,
        externalRosterId: t.teamId,
        name: t.name,
        division: t.division ?? null,
        madePlayoffs: qualified.has(t.teamId),
      })
      .returning({ id: teamSeason.id });
    await db.insert(teamSeasonManager).values({ teamSeasonId: ts!.id, managerId, role: "primary" });
    teamSeasonByLegacy.set(t.teamId, ts!.id);
  }

  // Games. No bracket data exists for these seasons, so playoff-week games are game_type 'none' (doc §2).
  const perWeek = new Map<number, number>();
  for (const m of md.matchups) {
    if (m.team2 === "BYE" || m.team2 === "TBD") continue;
    const a = teamSeasonByLegacy.get(m.team1.teamId);
    const b = teamSeasonByLegacy.get(m.team2.teamId);
    if (a === undefined || b === undefined) continue;
    const n = (perWeek.get(m.week) ?? 0) + 1;
    perWeek.set(m.week, n);
    const regular = m.week < md.playoffWeekStart;
    const [row] = await db
      .insert(matchup)
      .values({
        leagueSeasonId: seasonId,
        week: m.week,
        externalMatchupId: n,
        gameType: regular ? "regular" : "none",
      })
      .returning({ id: matchup.id });
    await db.insert(teamWeek).values([
      {
        leagueSeasonId: seasonId,
        teamSeasonId: a,
        week: m.week,
        matchupId: row!.id,
        opponentTeamSeasonId: b,
        counts: regular,
        points: m.team1.points,
        isFinal: true,
      },
      {
        leagueSeasonId: seasonId,
        teamSeasonId: b,
        week: m.week,
        matchupId: row!.id,
        opponentTeamSeasonId: a,
        counts: regular,
        points: m.team2.points,
        isFinal: true,
      },
    ]);
    input.summary.espnMatchups++;
  }
  return seasonId;
}

export async function recordMigrationRun(db: Db, summary: MongoMigrationSummary) {
  await db.insert(syncRun).values({
    kind: "migrate_mongo",
    status: "success",
    finishedAt: new Date(),
    stats: summary as unknown as Record<string, unknown>,
    triggeredBy: "cli",
  });
}

export { createDb };
