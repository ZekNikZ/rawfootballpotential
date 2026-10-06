import {
  bumpDataVersion,
  franchise,
  league,
  leagueSeason,
  manager,
  managerIdentity,
  teamSeason,
  teamSeasonManager,
  and,
  asc,
  eq,
  inArray,
  sql,
} from "@rfp/db";
import {
  franchisePatch,
  identityInput,
  managerPatch,
  mergeInput,
  teamSeasonRemap,
} from "@rfp/core/admin";
import type { FastifyInstance } from "fastify";
import { HttpError } from "../lib/http";
import { audit, parseBody, type AdminDeps } from "./context";
import { idParam, uniqueViolation } from "./util";

export function registerPeopleRoutes(app: FastifyInstance, deps: AdminDeps) {
  const { db } = deps;

  const seasonsOfManagers = async (managerIds: number[]): Promise<number[]> => {
    if (managerIds.length === 0) return [];
    const rows = await db
      .selectDistinct({ id: teamSeason.leagueSeasonId })
      .from(teamSeasonManager)
      .innerJoin(teamSeason, eq(teamSeason.id, teamSeasonManager.teamSeasonId))
      .where(inArray(teamSeasonManager.managerId, managerIds));
    return rows.map((r) => r.id);
  };

  // ---- managers ----
  app.get("/managers", async () => {
    const managers = await db.select().from(manager).orderBy(asc(manager.name));
    const identities = await db.select().from(managerIdentity);
    const seasons = await db
      .select({
        managerId: teamSeasonManager.managerId,
        n: sql<number>`count(distinct ${teamSeason.leagueSeasonId})::int`,
      })
      .from(teamSeasonManager)
      .innerJoin(teamSeason, eq(teamSeason.id, teamSeasonManager.teamSeasonId))
      .groupBy(teamSeasonManager.managerId);
    const count = new Map(seasons.map((s) => [s.managerId, s.n]));
    return {
      managers: managers.map((m) => ({
        ...m,
        seasons: count.get(m.id) ?? 0,
        identities: identities
          .filter((i) => i.managerId === m.id)
          .map((i) => ({ id: i.id, source: i.source, externalUserId: i.externalUserId })),
      })),
    };
  });

  app.patch<{ Params: { id: string } }>("/managers/:id", async (req) => {
    const id = idParam(req.params.id);
    const patch = parseBody(managerPatch, req.body);
    const [before] = await db.select().from(manager).where(eq(manager.id, id));
    if (!before) throw new HttpError(404, "Unknown manager");
    if (Object.keys(patch).length === 0) return before;
    const [after] = await db.update(manager).set(patch).where(eq(manager.id, id)).returning();
    await audit(db, req.admin!, "manager.update", "manager", id, before, after);
    await bumpDataVersion(db, await seasonsOfManagers([id]));
    return after;
  });

  app.post<{ Params: { id: string } }>("/managers/:id/identities", async (req, reply) => {
    const id = idParam(req.params.id);
    const input = parseBody(identityInput, req.body);
    const [m] = await db.select().from(manager).where(eq(manager.id, id));
    if (!m) throw new HttpError(404, "Unknown manager");
    try {
      const [row] = await db
        .insert(managerIdentity)
        .values({ managerId: id, ...input })
        .returning();
      await audit(db, req.admin!, "manager.identity.add", "manager", id, null, row);
      return reply.code(201).send(row);
    } catch (err) {
      if (uniqueViolation(err))
        throw new HttpError(409, "That account already belongs to a manager");
      throw err;
    }
  });

  app.delete<{ Params: { id: string; identityId: string } }>(
    "/managers/:id/identities/:identityId",
    async (req, reply) => {
      const id = idParam(req.params.id);
      const identityId = idParam(req.params.identityId);
      const [before] = await db
        .select()
        .from(managerIdentity)
        .where(and(eq(managerIdentity.id, identityId), eq(managerIdentity.managerId, id)));
      if (!before) throw new HttpError(404, "Unknown identity");
      await db.delete(managerIdentity).where(eq(managerIdentity.id, identityId));
      await audit(db, req.admin!, "manager.identity.remove", "manager", id, before, null);
      return reply.code(204).send();
    }
  );

  // Merge a duplicate manager into another: identities and team seasons move, the duplicate goes away.
  app.post("/managers/merge", async (req) => {
    const { fromId, intoId } = parseBody(mergeInput, req.body);
    const rows = await db
      .select()
      .from(manager)
      .where(inArray(manager.id, [fromId, intoId]));
    const from = rows.find((r) => r.id === fromId);
    const into = rows.find((r) => r.id === intoId);
    if (!from || !into) throw new HttpError(404, "Unknown manager");
    const seasons = await seasonsOfManagers([fromId, intoId]);
    const moved = await db.transaction(async (tx) => {
      const ids = await tx
        .update(managerIdentity)
        .set({ managerId: intoId })
        .where(eq(managerIdentity.managerId, fromId))
        .returning({ id: managerIdentity.id });
      // A team season both managers were on keeps the target's row only.
      await tx.execute(sql`
        delete from team_season_manager a
        where a.manager_id = ${fromId}
          and exists (select 1 from team_season_manager b where b.team_season_id = a.team_season_id and b.manager_id = ${intoId})`);
      const seasonRows = await tx
        .update(teamSeasonManager)
        .set({ managerId: intoId })
        .where(eq(teamSeasonManager.managerId, fromId))
        .returning({ id: teamSeasonManager.teamSeasonId });
      await tx.delete(manager).where(eq(manager.id, fromId));
      return { identities: ids.length, teamSeasons: seasonRows.length };
    });
    await audit(db, req.admin!, "manager.merge", "manager", intoId, { from, into }, moved);
    await bumpDataVersion(db, seasons);
    return { intoId, ...moved };
  });

  // ---- franchises ----
  app.get<{ Querystring: { leagueId?: string } }>("/franchises", async (req) => {
    const leagueId = idParam(req.query.leagueId ?? "");
    const franchises = await db
      .select()
      .from(franchise)
      .where(eq(franchise.leagueId, leagueId))
      .orderBy(asc(franchise.id));
    const teams = await db
      .select({
        id: teamSeason.id,
        franchiseId: teamSeason.franchiseId,
        year: leagueSeason.year,
        leagueSeasonId: leagueSeason.id,
        name: teamSeason.name,
        externalRosterId: teamSeason.externalRosterId,
      })
      .from(teamSeason)
      .innerJoin(leagueSeason, eq(leagueSeason.id, teamSeason.leagueSeasonId))
      .where(eq(leagueSeason.leagueId, leagueId))
      .orderBy(asc(leagueSeason.year));
    const mgrs = await db
      .select({ teamSeasonId: teamSeasonManager.teamSeasonId, name: manager.name })
      .from(teamSeasonManager)
      .innerJoin(manager, eq(manager.id, teamSeasonManager.managerId))
      .where(
        inArray(
          teamSeasonManager.teamSeasonId,
          teams.map((t) => t.id)
        )
      );
    const nameOf = new Map<number, string[]>();
    for (const m of mgrs)
      nameOf.set(m.teamSeasonId, [...(nameOf.get(m.teamSeasonId) ?? []), m.name]);
    return {
      franchises: franchises.map((f) => ({
        id: f.id,
        name: f.name,
        teamSeasons: teams
          .filter((t) => t.franchiseId === f.id)
          .map((t) => ({ ...t, managers: nameOf.get(t.id) ?? [] })),
      })),
    };
  });

  app.patch<{ Params: { id: string } }>("/franchises/:id", async (req) => {
    const id = idParam(req.params.id);
    const patch = parseBody(franchisePatch, req.body);
    const [before] = await db.select().from(franchise).where(eq(franchise.id, id));
    if (!before) throw new HttpError(404, "Unknown franchise");
    const [after] = await db.update(franchise).set(patch).where(eq(franchise.id, id)).returning();
    await audit(db, req.admin!, "franchise.update", "franchise", id, before, after);
    const seasons = await db
      .select({ id: leagueSeason.id })
      .from(leagueSeason)
      .where(eq(leagueSeason.leagueId, before.leagueId));
    await bumpDataVersion(
      db,
      seasons.map((s) => s.id)
    );
    return after;
  });

  // Dynasty season -> franchise mapping: move one team season to another franchise of the same league.
  app.patch<{ Params: { id: string } }>("/team-seasons/:id", async (req) => {
    const id = idParam(req.params.id);
    const { franchiseId } = parseBody(teamSeasonRemap, req.body);
    const [ts] = await db
      .select({
        ts: teamSeason,
        leagueId: leagueSeason.leagueId,
      })
      .from(teamSeason)
      .innerJoin(leagueSeason, eq(leagueSeason.id, teamSeason.leagueSeasonId))
      .where(eq(teamSeason.id, id));
    if (!ts) throw new HttpError(404, "Unknown team season");
    const [target] = await db.select().from(franchise).where(eq(franchise.id, franchiseId));
    if (!target || target.leagueId !== ts.leagueId)
      throw new HttpError(400, "Pick a franchise of the same league");
    if (target.id === ts.ts.franchiseId) return ts.ts;
    const clash = await db
      .select({ id: teamSeason.id })
      .from(teamSeason)
      .where(
        and(
          eq(teamSeason.leagueSeasonId, ts.ts.leagueSeasonId),
          eq(teamSeason.franchiseId, franchiseId)
        )
      );
    if (clash.length) throw new HttpError(409, "That franchise already has a team in this season");
    const [after] = await db
      .update(teamSeason)
      .set({ franchiseId })
      .where(eq(teamSeason.id, id))
      .returning();
    await audit(db, req.admin!, "team_season.remap", "team_season", id, ts.ts, after);
    await bumpDataVersion(db, [ts.ts.leagueSeasonId]);
    return after;
  });

  void league;
}
