import {
  leagueSeason,
  leagueThreshold,
  override,
  teamSeason,
  and,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from "@rfp/db";
import { overrideDeactivate, overrideInput, thresholdInput } from "@rfp/core/admin";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../lib/http";
import { audit, parseBody, type AdminDeps } from "./context";
import { idParam } from "./util";

/**
 * Keys the ingest/derive code looks overrides up by (apps/ingest: `teamWeekOverrideKey`, `teamSeasonOverrideKey`,
 * and the matchup key in sleeper/games.ts). Kept in one place on this side; the override-survives-reingest tests
 * exercise the real consumers.
 */
export const overrideKeys = {
  teamWeek: (leagueSeasonId: number, roster: string, week: number) =>
    `ls:${leagueSeasonId}:r:${roster}:w:${week}`,
  teamSeason: (leagueSeasonId: number, roster: string) => `ls:${leagueSeasonId}:r:${roster}`,
  matchup: (leagueSeasonId: number, week: number, externalMatchupId: number) =>
    `ls:${leagueSeasonId}:w:${week}:m:${externalMatchupId}`,
};

const listQuery = z.object({
  active: z.enum(["true", "false", "all"]).default("true"),
  leagueSeasonId: z.coerce.number().int().positive().optional(),
});

export function registerResultsRoutes(app: FastifyInstance, deps: AdminDeps) {
  const { db, jobs } = deps;

  const queueRecompute = (leagueSeasonId: number, userId: string, renormalize: boolean) =>
    jobs.send("recompute", { leagueSeasonId, renormalize, triggeredBy: userId });

  // ---- overrides ----
  app.get("/overrides", async (req) => {
    const q = listQuery.parse(req.query);
    const rows = await db
      .select()
      .from(override)
      .where(q.active === "all" ? undefined : eq(override.active, q.active === "true"))
      .orderBy(desc(override.createdAt))
      .limit(500);
    const parsed = rows.map((r) => {
      const m = /^ls:(\d+):(?:r:([^:]+))?(?::w:(\d+))?(?::m:(\d+))?$/.exec(r.entityId);
      return {
        row: r,
        leagueSeasonId: m ? Number(m[1]) : null,
        roster: m?.[2] ?? null,
        week: m?.[3] ? Number(m[3]) : null,
        externalMatchupId: m?.[4] ? Number(m[4]) : null,
      };
    });
    const filtered = parsed.filter(
      (p) => q.leagueSeasonId === undefined || p.leagueSeasonId === q.leagueSeasonId
    );
    const seasonIds = [...new Set(filtered.map((p) => p.leagueSeasonId).filter((x) => x !== null))];
    const seasons = seasonIds.length
      ? await db
          .select({ id: leagueSeason.id, year: leagueSeason.year })
          .from(leagueSeason)
          .where(inArray(leagueSeason.id, seasonIds))
      : [];
    const teams = seasonIds.length
      ? await db
          .select({
            lsId: teamSeason.leagueSeasonId,
            roster: teamSeason.externalRosterId,
            name: teamSeason.name,
          })
          .from(teamSeason)
          .where(inArray(teamSeason.leagueSeasonId, seasonIds))
      : [];
    return {
      overrides: filtered.map((p) => ({
        id: p.row.id,
        entity: p.row.entity,
        field: p.row.field,
        value: p.row.value,
        reason: p.row.reason,
        active: p.row.active,
        createdAt: p.row.createdAt,
        createdBy: p.row.createdBy,
        year: seasons.find((s) => s.id === p.leagueSeasonId)?.year ?? null,
        leagueSeasonId: p.leagueSeasonId,
        week: p.week,
        externalMatchupId: p.externalMatchupId,
        team: teams.find((t) => t.lsId === p.leagueSeasonId && t.roster === p.roster)?.name ?? null,
      })),
    };
  });

  app.post("/overrides", async (req, reply) => {
    const input = parseBody(overrideInput, req.body);
    let leagueSeasonId: number;
    let entity: string;
    let entityId: string;
    let field: string;
    let value: unknown;
    let sleeperOnly = false;

    if (input.kind === "game_type") {
      leagueSeasonId = input.leagueSeasonId;
      entity = "matchup";
      entityId = overrideKeys.matchup(leagueSeasonId, input.week, input.externalMatchupId);
      field = "game_type";
      value = input.gameType;
      sleeperOnly = true;
    } else {
      const [ts] = await db
        .select({ roster: teamSeason.externalRosterId, leagueSeasonId: teamSeason.leagueSeasonId })
        .from(teamSeason)
        .where(eq(teamSeason.id, input.teamSeasonId));
      if (!ts) throw new HttpError(404, "Unknown team season");
      leagueSeasonId = ts.leagueSeasonId;
      if (input.kind === "score") {
        entity = "team_week";
        entityId = overrideKeys.teamWeek(leagueSeasonId, ts.roster, input.week);
        field = "points";
        value = input.points;
        sleeperOnly = true;
      } else {
        entity = "team_season";
        entityId = overrideKeys.teamSeason(leagueSeasonId, ts.roster);
        field = "final_place";
        value = input.place;
      }
    }

    const [season] = await db
      .select()
      .from(leagueSeason)
      .where(eq(leagueSeason.id, leagueSeasonId));
    if (!season) throw new HttpError(404, "Unknown season");
    if (sleeperOnly && season.source !== "sleeper")
      throw new HttpError(
        400,
        "Score and game-type corrections apply to Sleeper seasons; ESPN seasons are corrected once their data is imported"
      );

    const created = await db.transaction(async (tx) => {
      const prior = await tx
        .update(override)
        .set({ active: false })
        .where(
          and(
            eq(override.entity, entity),
            eq(override.entityId, entityId),
            eq(override.field, field),
            eq(override.active, true)
          )
        )
        .returning();
      const [row] = await tx
        .insert(override)
        .values({
          entity,
          entityId,
          field,
          value,
          reason: input.reason,
          createdBy: req.admin!.id,
        })
        .returning();
      return { row: row!, replaced: prior.map((p) => p.id) };
    });
    await audit(db, req.admin!, "override.create", "override", created.row.id, null, {
      ...created.row,
      replaced: created.replaced,
    });
    await queueRecompute(leagueSeasonId, req.admin!.id, sleeperOnly);
    return reply.code(201).send(created.row);
  });

  app.delete<{ Params: { id: string } }>("/overrides/:id", async (req) => {
    const id = idParam(req.params.id);
    const { reason } = parseBody(overrideDeactivate, req.body);
    const [before] = await db.select().from(override).where(eq(override.id, id));
    if (!before) throw new HttpError(404, "Unknown override");
    if (!before.active) return before;
    const [after] = await db
      .update(override)
      .set({ active: false })
      .where(eq(override.id, id))
      .returning();
    await audit(db, req.admin!, "override.deactivate", "override", id, before, {
      ...after,
      reason,
    });
    const m = /^ls:(\d+):/.exec(before.entityId);
    if (m) await queueRecompute(Number(m[1]), req.admin!.id, before.entity !== "team_season");
    return after;
  });

  // The games of one week, so a game-type correction can be aimed at the right one.
  app.get("/matchups", async (req) => {
    const q = z
      .object({
        leagueSeasonId: z.coerce.number().int().positive(),
        week: z.coerce.number().int().min(1).max(30),
      })
      .parse(req.query);
    const rows = await db.execute<{
      external_matchup_id: number;
      game_type: string;
      bracket: string | null;
      team: string;
      points: number;
    }>(sql`
      select mt.external_matchup_id, mt.game_type::text as game_type, mt.bracket::text as bracket, ts.name as team,
             tw.points::float8 as points
      from matchup mt join team_week tw on tw.matchup_id = mt.id join team_season ts on ts.id = tw.team_season_id
      where mt.league_season_id = ${q.leagueSeasonId} and mt.week = ${q.week}
      order by mt.external_matchup_id, ts.name`);
    const games = new Map<
      number,
      {
        externalMatchupId: number;
        gameType: string;
        bracket: string | null;
        teams: { team: string; points: number }[];
      }
    >();
    for (const r of rows.rows) {
      const g = games.get(r.external_matchup_id) ?? {
        externalMatchupId: r.external_matchup_id,
        gameType: r.game_type,
        bracket: r.bracket,
        teams: [],
      };
      g.teams.push({ team: r.team, points: r.points });
      games.set(r.external_matchup_id, g);
    }
    return { games: [...games.values()] };
  });

  // ---- thresholds ----
  app.get<{ Querystring: { leagueId?: string } }>("/thresholds", async (req) => {
    const leagueId = idParam(req.query.leagueId ?? "");
    const rows = await db
      .select()
      .from(leagueThreshold)
      .where(eq(leagueThreshold.leagueId, leagueId));
    return { thresholds: rows };
  });

  app.put("/thresholds", async (req) => {
    const input = parseBody(thresholdInput, req.body);
    const [prior] = await db
      .select()
      .from(leagueThreshold)
      .where(
        and(
          eq(leagueThreshold.leagueId, input.leagueId),
          eq(leagueThreshold.key, input.key),
          input.leagueSeasonId === null
            ? isNull(leagueThreshold.leagueSeasonId)
            : eq(leagueThreshold.leagueSeasonId, input.leagueSeasonId)
        )
      );
    const existing = prior;
    const [row] = existing
      ? await db
          .update(leagueThreshold)
          .set({ value: input.value })
          .where(eq(leagueThreshold.id, existing.id))
          .returning()
      : await db.insert(leagueThreshold).values(input).returning();
    await audit(
      db,
      req.admin!,
      "threshold.set",
      "league_threshold",
      row!.id,
      existing ?? null,
      row
    );
    await recomputeLeague(input.leagueId, input.leagueSeasonId, req.admin!.id);
    return row;
  });

  app.delete<{ Params: { id: string } }>("/thresholds/:id", async (req, reply) => {
    const id = idParam(req.params.id);
    const [before] = await db.select().from(leagueThreshold).where(eq(leagueThreshold.id, id));
    if (!before) throw new HttpError(404, "Unknown threshold");
    await db.delete(leagueThreshold).where(eq(leagueThreshold.id, id));
    await audit(db, req.admin!, "threshold.delete", "league_threshold", id, before, null);
    await recomputeLeague(before.leagueId, before.leagueSeasonId, req.admin!.id);
    return reply.code(204).send();
  });

  async function recomputeLeague(leagueId: number, leagueSeasonId: number | null, userId: string) {
    const ids =
      leagueSeasonId !== null
        ? [leagueSeasonId]
        : (
            await db
              .select({ id: leagueSeason.id })
              .from(leagueSeason)
              .where(eq(leagueSeason.leagueId, leagueId))
          ).map((s) => s.id);
    for (const id of ids) await queueRecompute(id, userId, false);
  }
}
