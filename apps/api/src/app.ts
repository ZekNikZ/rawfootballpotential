import Fastify, { type FastifyInstance } from "fastify";
import {
  dataVersion,
  league,
  recordConfig,
  leagueSeason,
  nflState,
  siteConfig,
  syncRun,
  and,
  desc,
  eq,
  isNull,
  or,
  sql,
} from "@rfp/db";
import type { Db } from "@rfp/db";
import { RECORD_CATALOG, queryKey, recordQuerySchema, type Requirement } from "@rfp/core";
import { z } from "zod";
import type { Config } from "./config";
import { blogPosts } from "./info/blog";
import { franchiseEntities, headToHead, placementHistory, trophyCase } from "./info/league-data";
import { franchiseProfile } from "./info/profile";
import {
  drafts,
  futurePicks,
  matchups,
  standings,
  teams,
  transactionFeed,
} from "./info/season-pages";
import { HttpError, sendCacheable } from "./lib/http";
import { leagueBySlug, seasonById } from "./lib/leagues";
import { registerAdmin } from "./admin";
import type { AdminDeps } from "./admin/context";
import { RecordError, runRecord } from "./records/run";

export interface AppOptions {
  db: Db;
  config?: Partial<Config>;
  logger?: boolean | { level: string };
  /** Auth, job queue and origins for the admin API; omitted = no admin endpoints. */
  admin?: AdminDeps;
}

const REQUIREMENT_FLAG = {
  playerData: "hasPlayerData",
  projections: "hasProjections",
  transactions: "hasTransactions",
  draft: "hasDraft",
  faab: "hasFaab",
  auctionDraft: "hasAuctionDraft",
} as const satisfies Record<Requirement, keyof typeof leagueSeason.$inferSelect>;

const idParam = z.coerce.number().int().positive();
const weekQuery = z.object({ week: z.coerce.number().int().min(1).max(30).optional() });

/** Completed seasons never change, so their pages can be cached for longer than live ones. */
const maxAgeFor = (status: string) => (status === "complete" ? 300 : 15);

export function buildApp({ db, config = {}, logger = false, admin }: AppOptions): FastifyInstance {
  const app = Fastify({ logger, trustProxy: config.TRUST_PROXY ?? false });

  // An action POST with no body (e.g. "create a reset link") is an empty object, not a parse error.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "") return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      const err = new Error("Invalid JSON body") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError || err instanceof RecordError)
      return reply.code(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) {
      return reply
        .code(400)
        .send({ error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    }
    // Framework-level client errors (bad JSON, oversized body, ...) keep their own 4xx status.
    const status = (err as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500)
      return reply.code(status).send({ error: err instanceof Error ? err.message : "bad request" });
    req.log.error({ err }, "request failed");
    return reply.code(500).send({ error: "internal error" });
  });

  // ---- health ----
  app.get("/healthz", async (_req, reply) => {
    const lastOk = async (kind: "finalize" | "daily") => {
      const [row] = await db
        .select({ at: syncRun.finishedAt })
        .from(syncRun)
        .where(and(eq(syncRun.kind, kind), eq(syncRun.status, "success")))
        .orderBy(desc(syncRun.finishedAt))
        .limit(1);
      return row?.at ?? null;
    };
    try {
      await db.execute(sql`select 1`);
    } catch {
      return reply.code(503).send({ ok: false, db: false });
    }
    return {
      ok: true,
      db: true,
      lastDaily: await lastOk("daily"),
      lastFinalize: await lastOk("finalize"),
    };
  });

  // ---- site, leagues ----
  app.get("/api/site", async (req, reply) => {
    const rows = await db.select().from(siteConfig);
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const [state] = await db.select().from(nflState).orderBy(desc(nflState.season)).limit(1);
    return sendCacheable(
      req,
      reply,
      { site: cfg.site ?? null, changelog: cfg.changelog ?? [], nflState: state ?? null },
      60
    );
  });

  app.get("/api/leagues", async (req, reply) => {
    const leagues = await db
      .select()
      .from(league)
      .where(eq(league.enabled, true))
      .orderBy(league.displayOrder);
    const seasons = await db
      .select()
      .from(leagueSeason)
      .where(eq(leagueSeason.enabled, true))
      .orderBy(leagueSeason.year);
    return sendCacheable(
      req,
      reply,
      {
        leagues: leagues.map((l) => ({
          id: l.id,
          slug: l.slug,
          name: l.name,
          type: l.type,
          color: l.color,
          seasons: seasons
            .filter((s) => s.leagueId === l.id)
            .map((s) => ({
              id: s.id,
              year: s.year,
              source: s.source,
              status: s.status,
              regularSeasonWeeks: s.regularSeasonWeeks,
              playoffWeekStart: s.playoffWeekStart,
              lastWeek: s.lastWeek,
              playoffTeams: s.playoffTeams,
              teamCount: s.teamCount,
              medianEnabled: s.medianEnabled,
              hasLosersBracket: s.hasLosersBracket,
              lastCompletedWeek: s.lastCompletedWeek,
              data: {
                playerData: s.hasPlayerData,
                projections: s.hasProjections,
                transactions: s.hasTransactions,
                draft: s.hasDraft,
                faab: s.hasFaab,
                auctionDraft: s.hasAuctionDraft,
              },
            })),
        })),
      },
      30
    );
  });

  // ---- records ----
  app.get<{ Params: { league: string } }>("/api/leagues/:league/records", async (req, reply) => {
    const lg = await leagueBySlug(db, req.params.league);
    const seasons = await db
      .select()
      .from(leagueSeason)
      .where(and(eq(leagueSeason.leagueId, lg.id), eq(leagueSeason.enabled, true)));
    // Admin settings: a league's own row beats the global one; position = sortOrder, or the catalog slot * 10.
    const settings = await db
      .select()
      .from(recordConfig)
      .where(or(isNull(recordConfig.leagueId), eq(recordConfig.leagueId, lg.id)));
    const settingFor = (id: string) =>
      settings.find((c) => c.recordId === id && c.leagueId === lg.id) ??
      settings.find((c) => c.recordId === id && c.leagueId === null);
    const records = RECORD_CATALOG.map((r, i) => {
      const satisfying = seasons.filter((s) => r.requires.every((q) => s[REQUIREMENT_FLAG[q]]));
      const cfg = settingFor(r.id);
      return {
        ...r,
        availableFrom: satisfying.length ? Math.min(...satisfying.map((s) => s.year)) : null,
        featured: cfg?.featured ?? false,
        position: cfg && cfg.sortOrder > 0 ? cfg.sortOrder : (i + 1) * 10,
        visible: cfg?.visible ?? true,
      };
    })
      .filter((r) => r.visible)
      .sort((a, b) => a.position - b.position)
      .map(({ visible: _visible, position: _position, ...r }) => r);
    return sendCacheable(req, reply, { league: lg.slug, records }, 60);
  });

  app.get<{ Params: { league: string; id: string }; Querystring: Record<string, string> }>(
    "/api/leagues/:league/records/:id",
    async (req, reply) => {
      const lg = await leagueBySlug(db, req.params.league);
      const response = await runRecord(db, lg.id, req.params.id, req.query);
      return sendCacheable(
        req,
        reply,
        response,
        60,
        `${req.params.id}|${response.dataVersion}|${queryKey(response.params)}`
      );
    }
  );

  app.get<{ Params: { league: string }; Querystring: Record<string, string> }>(
    "/api/leagues/:league/h2h",
    async (req, reply) => {
      const lg = await leagueBySlug(db, req.params.league);
      const q = recordQuerySchema
        .pick({ seasons: true, scope: true, median: true })
        .parse(req.query);
      return sendCacheable(req, reply, await headToHead(db, lg.id, q), 60);
    }
  );

  app.get<{ Params: { league: string } }>("/api/leagues/:league/placements", async (req, reply) => {
    const lg = await leagueBySlug(db, req.params.league);
    return sendCacheable(req, reply, await placementHistory(db, lg.id), 60);
  });

  app.get<{ Params: { league: string }; Querystring: { season?: string } }>(
    "/api/leagues/:league/trophies",
    async (req, reply) => {
      const lg = await leagueBySlug(db, req.params.league);
      const season = req.query.season === undefined ? undefined : idParam.parse(req.query.season);
      return sendCacheable(
        req,
        reply,
        await trophyCase(db, lg.id, season === undefined ? {} : { season }),
        60
      );
    }
  );

  app.get<{ Params: { league: string; id: string } }>(
    "/api/leagues/:league/franchises/:id",
    async (req, reply) => {
      const lg = await leagueBySlug(db, req.params.league);
      return sendCacheable(
        req,
        reply,
        await franchiseProfile(db, lg.id, idParam.parse(req.params.id)),
        60
      );
    }
  );

  app.get<{ Params: { league: string } }>("/api/leagues/:league/franchises", async (req, reply) => {
    const lg = await leagueBySlug(db, req.params.league);
    const ids = (
      await db.execute<{ id: number }>(
        sql`select id from franchise where league_id = ${lg.id} order by id`
      )
    ).rows.map((r) => r.id);
    return sendCacheable(
      req,
      reply,
      { franchises: ids, entities: await franchiseEntities(db, ids) },
      60
    );
  });

  app.get<{ Params: { league: string } }>("/api/leagues/:league/picks", async (req, reply) => {
    const lg = await leagueBySlug(db, req.params.league);
    return sendCacheable(req, reply, await futurePicks(db, lg.id), 60);
  });

  // ---- season info pages (may include in-progress weeks) ----
  app.get<{ Params: { seasonId: string }; Querystring: Record<string, string> }>(
    "/api/seasons/:seasonId/standings",
    async (req, reply) => {
      const { season } = await seasonById(db, idParam.parse(req.params.seasonId));
      const { week } = weekQuery.parse(req.query);
      return sendCacheable(
        req,
        reply,
        await standings(db, season.id, week),
        maxAgeFor(season.status)
      );
    }
  );

  app.get<{ Params: { seasonId: string }; Querystring: Record<string, string> }>(
    "/api/seasons/:seasonId/matchups",
    async (req, reply) => {
      const { season } = await seasonById(db, idParam.parse(req.params.seasonId));
      const { week } = weekQuery.parse(req.query);
      const players = req.query.players === "true" || req.query.players === "1";
      return sendCacheable(
        req,
        reply,
        await matchups(db, season.id, week, players),
        maxAgeFor(season.status)
      );
    }
  );

  app.get<{ Params: { seasonId: string }; Querystring: Record<string, string> }>(
    "/api/seasons/:seasonId/teams",
    async (req, reply) => {
      const { season } = await seasonById(db, idParam.parse(req.params.seasonId));
      const rosters = req.query.rosters === "true" || req.query.rosters === "1";
      return sendCacheable(
        req,
        reply,
        await teams(db, season.id, rosters),
        maxAgeFor(season.status)
      );
    }
  );

  app.get<{ Params: { seasonId: string }; Querystring: Record<string, string> }>(
    "/api/seasons/:seasonId/transactions",
    async (req, reply) => {
      const { season } = await seasonById(db, idParam.parse(req.params.seasonId));
      const q = z
        .object({
          type: z.enum(["trade", "waiver", "free_agent", "commissioner"]).optional(),
          team: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);
      const filters = {
        limit: q.limit,
        offset: q.offset,
        ...(q.type ? { type: q.type } : {}),
        ...(q.team ? { teamSeasonId: q.team } : {}),
      };
      return sendCacheable(
        req,
        reply,
        await transactionFeed(db, season.id, filters),
        maxAgeFor(season.status)
      );
    }
  );

  app.get<{ Params: { seasonId: string } }>("/api/seasons/:seasonId/draft", async (req, reply) => {
    const { season } = await seasonById(db, idParam.parse(req.params.seasonId));
    return sendCacheable(req, reply, await drafts(db, season.id), maxAgeFor(season.status));
  });

  // ---- blog (RSS proxy + cache) ----
  app.get("/api/blog", async (req, reply) => {
    const feed =
      config.BLOG_FEED_URL ??
      "https://jaytalentedmo.wixsite.com/raw-football-potenti/blog-feed.xml";
    try {
      return sendCacheable(req, reply, { posts: await blogPosts(db, feed) }, 300);
    } catch (err) {
      req.log.warn({ err }, "blog feed unavailable");
      return reply.code(502).send({ error: "blog feed unavailable" });
    }
  });

  if (admin) app.register(async (instance) => registerAdmin(instance, admin));

  void dataVersion;
  return app;
}
