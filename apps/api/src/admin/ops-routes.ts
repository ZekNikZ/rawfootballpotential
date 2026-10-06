import {
  league,
  leagueSeason,
  player,
  playerIdMap,
  recordConfig,
  syncRun,
  unmatchedPlayer,
  and,
  desc,
  eq,
  ilike,
  isNull,
  sql,
} from "@rfp/db";
import { JOBS, jobInput, recordConfigInput, unmatchedMap } from "@rfp/core/admin";
import { RECORD_CATALOG } from "@rfp/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../lib/http";
import { audit, parseBody, type AdminDeps } from "./context";
import { idParam, pageQuery } from "./util";

export function registerOpsRoutes(app: FastifyInstance, deps: AdminDeps) {
  const { db, jobs } = deps;

  // ---- unmatched players ----
  app.get("/players/unmatched", async (req) => {
    const q = z
      .object({ status: z.enum(["open", "mapped", "ignored"]).default("open") })
      .parse(req.query);
    const rows = await db
      .select()
      .from(unmatchedPlayer)
      .where(eq(unmatchedPlayer.status, q.status))
      .orderBy(desc(unmatchedPlayer.firstSeenAt))
      .limit(500);
    return { unmatched: rows };
  });

  app.get("/players/search", async (req) => {
    const q = z.object({ q: z.string().trim().min(2).max(60) }).parse(req.query);
    const rows = await db
      .select({
        id: player.id,
        name: player.fullName,
        position: player.position,
        nflTeam: player.nflTeam,
        sleeperId: player.sleeperId,
        espnId: player.espnId,
      })
      .from(player)
      .where(ilike(player.fullName, `%${q.q.replace(/[%_]/g, "")}%`))
      .limit(20);
    return { players: rows };
  });

  app.post<{ Params: { id: string } }>("/players/unmatched/:id/map", async (req) => {
    const id = idParam(req.params.id);
    const { playerId } = parseBody(unmatchedMap, req.body);
    const [row] = await db.select().from(unmatchedPlayer).where(eq(unmatchedPlayer.id, id));
    if (!row) throw new HttpError(404, "Unknown entry");
    const [target] = await db.select().from(player).where(eq(player.id, playerId));
    if (!target) throw new HttpError(404, "Unknown player");
    await db.transaction(async (tx) => {
      await tx.insert(playerIdMap).values({
        playerId,
        name: row.name ?? target.fullName,
        manual: true,
        ...(row.source === "espn" ? { espnId: row.externalId } : { sleeperId: row.externalId }),
      });
      if (row.source === "espn") {
        await tx.update(player).set({ espnId: row.externalId }).where(eq(player.id, playerId));
      } else if (target.sleeperId === null) {
        await tx.update(player).set({ sleeperId: row.externalId }).where(eq(player.id, playerId));
      }
      await tx
        .update(unmatchedPlayer)
        .set({ status: "mapped", resolvedPlayerId: playerId })
        .where(eq(unmatchedPlayer.id, id));
    });
    await audit(db, req.admin!, "player.map", "unmatched_player", id, row, { playerId });
    return { id, status: "mapped", playerId };
  });

  app.post<{ Params: { id: string } }>("/players/unmatched/:id/ignore", async (req) => {
    const id = idParam(req.params.id);
    const [row] = await db.select().from(unmatchedPlayer).where(eq(unmatchedPlayer.id, id));
    if (!row) throw new HttpError(404, "Unknown entry");
    await db.update(unmatchedPlayer).set({ status: "ignored" }).where(eq(unmatchedPlayer.id, id));
    await audit(db, req.admin!, "player.ignore", "unmatched_player", id, row, {
      status: "ignored",
    });
    return { id, status: "ignored" };
  });

  // ---- records: show / hide / order / feature ----
  app.get("/records", async () => {
    const config = await db.select().from(recordConfig);
    const leagues = await db.select({ id: league.id, name: league.name }).from(league);
    return {
      leagues,
      records: RECORD_CATALOG.map((r) => ({
        id: r.id,
        title: r.title,
        section: r.section,
        category: r.category,
      })),
      config,
    };
  });

  app.put("/records", async (req) => {
    const input = parseBody(recordConfigInput, req.body);
    if (!RECORD_CATALOG.some((r) => r.id === input.recordId))
      throw new HttpError(400, "Unknown record");
    const where = and(
      eq(recordConfig.recordId, input.recordId),
      input.leagueId === null
        ? isNull(recordConfig.leagueId)
        : eq(recordConfig.leagueId, input.leagueId)
    );
    const [before] = await db.select().from(recordConfig).where(where);
    const [after] = before
      ? await db.update(recordConfig).set(input).where(eq(recordConfig.id, before.id)).returning()
      : await db.insert(recordConfig).values(input).returning();
    await audit(db, req.admin!, "record.config", "record_config", after!.id, before ?? null, after);
    return after;
  });

  // Back to defaults.
  app.delete<{ Params: { id: string } }>("/records/:id", async (req, reply) => {
    const id = idParam(req.params.id);
    const [before] = await db.select().from(recordConfig).where(eq(recordConfig.id, id));
    if (!before) throw new HttpError(404, "Unknown record setting");
    await db.delete(recordConfig).where(eq(recordConfig.id, id));
    await audit(db, req.admin!, "record.config.reset", "record_config", id, before, null);
    return reply.code(204).send();
  });

  // ---- jobs ----
  app.post<{ Params: { job: string } }>("/jobs/:job", async (req, reply) => {
    const job = z.enum(JOBS).safeParse(req.params.job);
    if (!job.success) throw new HttpError(404, "Unknown job");
    const input = parseBody(jobInput, req.body ?? {});
    if (input.leagueSeasonId !== undefined) {
      const [s] = await db
        .select({ id: leagueSeason.id })
        .from(leagueSeason)
        .where(eq(leagueSeason.id, input.leagueSeasonId));
      if (!s) throw new HttpError(404, "Unknown season");
    }
    const jobId = await jobs.send(job.data, {
      ...(input.leagueSeasonId !== undefined ? { leagueSeasonId: input.leagueSeasonId } : {}),
      // An admin-requested recompute re-normalizes from the cached raw data, so corrections apply.
      ...(job.data === "recompute" ? { renormalize: true } : {}),
      triggeredBy: req.admin!.id,
    });
    await audit(db, req.admin!, "job.trigger", "job", job.data, null, input);
    return reply.code(202).send({ queued: true, jobId });
  });

  app.get("/jobs/runs", async (req) => {
    const q = pageQuery
      .extend({
        kind: z.string().optional(),
        status: z.enum(["queued", "running", "success", "failed"]).optional(),
      })
      .parse(req.query);
    const rows = await db
      .select({
        id: syncRun.id,
        kind: syncRun.kind,
        leagueSeasonId: syncRun.leagueSeasonId,
        year: leagueSeason.year,
        league: league.slug,
        triggeredBy: syncRun.triggeredBy,
        startedAt: syncRun.startedAt,
        finishedAt: syncRun.finishedAt,
        status: syncRun.status,
        stats: syncRun.stats,
        log: syncRun.log,
      })
      .from(syncRun)
      .leftJoin(leagueSeason, eq(leagueSeason.id, syncRun.leagueSeasonId))
      .leftJoin(league, eq(league.id, leagueSeason.leagueId))
      .where(
        and(
          q.kind ? sql`${syncRun.kind}::text = ${q.kind}` : undefined,
          q.status ? eq(syncRun.status, q.status) : undefined
        )
      )
      .orderBy(desc(syncRun.startedAt))
      .limit(q.limit)
      .offset(q.offset);
    return { runs: rows };
  });
}
