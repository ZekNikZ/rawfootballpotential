import { bumpDataVersion, league, leagueSeason, siteConfig, and, asc, eq, inArray } from "@rfp/db";
import {
  DATA_FLAGS,
  changelogInput,
  leagueCreate,
  leaguePatch,
  seasonAdd,
  seasonPatch,
  siteInput,
} from "@rfp/core/admin";
import type { FastifyInstance } from "fastify";
import { HttpError } from "../lib/http";
import { audit, parseBody, type AdminDeps } from "./context";
import { idParam, uniqueViolation } from "./util";

export function registerConfigRoutes(app: FastifyInstance, deps: AdminDeps) {
  const { db, jobs } = deps;

  const readConfig = async (key: string) => {
    const [row] = await db.select().from(siteConfig).where(eq(siteConfig.key, key));
    return row?.value ?? null;
  };
  const writeConfig = async (key: string, value: unknown) => {
    await db
      .insert(siteConfig)
      .values({ key, value })
      .onConflictDoUpdate({ target: siteConfig.key, set: { value, updatedAt: new Date() } });
  };

  // ---- site ----
  app.get("/site", async () => ({
    site: (await readConfig("site")) ?? { name: "Raw Football Potential", shortName: "RFP" },
    changelog: (await readConfig("changelog")) ?? [],
  }));

  app.put("/site", async (req) => {
    const input = parseBody(siteInput, req.body);
    const before = await readConfig("site");
    await writeConfig("site", input);
    await audit(db, req.admin!, "site.update", "site_config", "site", before, input);
    return input;
  });

  app.put("/changelog", async (req) => {
    const input = parseBody(changelogInput, req.body);
    const before = await readConfig("changelog");
    await writeConfig("changelog", input);
    await audit(db, req.admin!, "changelog.update", "site_config", "changelog", before, input);
    return input;
  });

  // ---- leagues ----
  app.get("/leagues", async () => {
    const leagues = await db
      .select()
      .from(league)
      .orderBy(asc(league.displayOrder), asc(league.id));
    const seasons = await db
      .select()
      .from(leagueSeason)
      .orderBy(asc(leagueSeason.leagueId), asc(leagueSeason.year));
    return {
      leagues: leagues.map((l) => ({
        ...l,
        seasons: seasons
          .filter((s) => s.leagueId === l.id)
          .map((s) => ({
            id: s.id,
            year: s.year,
            source: s.source,
            externalId: s.externalId,
            status: s.status,
            enabled: s.enabled,
            teamCount: s.teamCount,
            scoringOverrides: s.scoringOverrides,
            flags: Object.fromEntries(DATA_FLAGS.map((f) => [f, s[f]])),
            lockedFlags: s.lockedFlags,
          })),
      })),
    };
  });

  app.post("/leagues", async (req, reply) => {
    const input = parseBody(leagueCreate, req.body);
    try {
      const [row] = await db
        .insert(league)
        .values({ ...input, displayOrder: 99 })
        .returning();
      await audit(db, req.admin!, "league.create", "league", row!.id, null, row);
      return reply.code(201).send(row);
    } catch (err) {
      if (uniqueViolation(err)) throw new HttpError(409, "A league with that slug already exists");
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>("/leagues/:id", async (req) => {
    const id = idParam(req.params.id);
    const patch = parseBody(leaguePatch, req.body);
    const [before] = await db.select().from(league).where(eq(league.id, id));
    if (!before) throw new HttpError(404, "Unknown league");
    try {
      const [after] = await db.update(league).set(patch).where(eq(league.id, id)).returning();
      await audit(db, req.admin!, "league.update", "league", id, before, after);
      // Enabling / disabling changes which seasons the public pages serve.
      if (patch.enabled !== undefined && patch.enabled !== before.enabled) {
        const ids = await db
          .select({ id: leagueSeason.id })
          .from(leagueSeason)
          .where(eq(leagueSeason.leagueId, id));
        await bumpDataVersion(
          db,
          ids.map((s) => s.id)
        );
      }
      return after;
    } catch (err) {
      if (uniqueViolation(err)) throw new HttpError(409, "A league with that slug already exists");
      throw err;
    }
  });

  // ---- seasons ----
  app.patch<{ Params: { id: string } }>("/seasons/:id", async (req) => {
    const id = idParam(req.params.id);
    const patch = parseBody(seasonPatch, req.body);
    const [before] = await db.select().from(leagueSeason).where(eq(leagueSeason.id, id));
    if (!before) throw new HttpError(404, "Unknown season");

    const set: Partial<typeof leagueSeason.$inferInsert> = {};
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (patch.scoringOverrides !== undefined) set.scoringOverrides = patch.scoringOverrides;
    if (patch.flags) {
      const locked = new Set(before.lockedFlags);
      for (const [flag, value] of Object.entries(patch.flags)) {
        if (value === null) locked.delete(flag);
        else {
          (set as Record<string, unknown>)[flag] = value;
          locked.add(flag);
        }
      }
      set.lockedFlags = [...locked];
    }
    if (Object.keys(set).length === 0) return before;

    const [after] = await db
      .update(leagueSeason)
      .set(set)
      .where(eq(leagueSeason.id, id))
      .returning();
    await audit(db, req.admin!, "season.update", "league_season", id, before, after);
    await bumpDataVersion(db, [id]);
    if (patch.scoringOverrides !== undefined)
      await jobs.send("recompute", {
        leagueSeasonId: id,
        renormalize: true,
        triggeredBy: req.admin!.id,
      });
    return after;
  });

  // Adding a season needs the source's league object, so the ingest worker does it.
  app.post("/seasons", async (req, reply) => {
    const input = parseBody(seasonAdd, req.body);
    const [lg] = await db.select().from(league).where(eq(league.id, input.leagueId));
    if (!lg) throw new HttpError(404, "Unknown league");
    const dup = await db
      .select({ id: leagueSeason.id })
      .from(leagueSeason)
      .where(
        and(eq(leagueSeason.source, input.source), eq(leagueSeason.externalId, input.externalId))
      );
    if (dup.length) throw new HttpError(409, "That Sleeper league is already added");
    const jobId = await jobs.send("add-season", {
      leagueId: input.leagueId,
      externalId: input.externalId,
      triggeredBy: req.admin!.id,
    });
    await audit(db, req.admin!, "season.add", "league_season", null, null, input);
    return reply.code(202).send({ queued: true, jobId });
  });

  void inArray;
}
