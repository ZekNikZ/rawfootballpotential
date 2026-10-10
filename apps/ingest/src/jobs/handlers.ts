import { dataVersion, leagueSeason, syncRun, eq, inArray, lt, or, sql, type Db } from "@rfp/db";
import { z } from "zod";
import { DERIVE_VERSION, deriveSeason } from "../derive/derive";
import { log } from "../lib/log";
import { hours } from "../lib/raw-store";
import { importEspnSeason } from "../espn/normalize";
import { syncNflReference } from "../nfl/reference";
import { pruneRecordCache } from "./prune";
import { listSeasons, runSeasonPipeline, type SeasonRef } from "../pipeline";
import type { SleeperClient } from "../sleeper/client";
import { syncPlayers } from "../sleeper/players";
import { seasonRollover } from "../sleeper/rollover";
import { bootstrapSleeperSeason } from "../sleeper/sync";

export type JobName =
  | "live"
  | "daily"
  | "finalize"
  | "nfl-reference"
  | "season-rollover"
  | "recompute"
  | "add-season"
  | "import-espn";

type SyncKind = (typeof syncRun.$inferInsert)["kind"];
type SeasonStatus = (typeof leagueSeason.$inferSelect)["status"];

export const JOB_KIND: Record<JobName, SyncKind> = {
  live: "live",
  daily: "daily",
  finalize: "finalize",
  "nfl-reference": "nfl_reference",
  "season-rollover": "season_rollover",
  recompute: "recompute",
  "add-season": "backfill",
  "import-espn": "import_espn",
};

export const jobPayload = z.object({
  leagueSeasonId: z.number().int().optional(),
  /** recompute: re-run normalize from the cached raw data first (admin corrections apply there), then derive. */
  renormalize: z.boolean().optional(),
  /** add-season: the league to add the Sleeper season to. */
  leagueId: z.number().int().optional(),
  externalId: z.string().optional(),
  /** Admin-triggered runs set this to the admin's user id. */
  triggeredBy: z.string().optional(),
});
export type JobPayload = z.infer<typeof jobPayload>;

export interface JobContext {
  db: Db;
  client: SleeperClient;
  /** Called after a season's derived data changed (finalize / recompute); the API layer warms caches here. */
  onSeasonChanged?: (leagueSeasonId: number) => Promise<void>;
}

/** Wraps a job run in a sync_run row (visible in the admin UI and used by /healthz). */
export async function tracked<T extends Record<string, unknown> | void>(
  db: Db,
  kind: SyncKind,
  payload: JobPayload,
  fn: () => Promise<T>
): Promise<T> {
  const [run] = await db
    .insert(syncRun)
    .values({
      kind,
      leagueSeasonId: payload.leagueSeasonId ?? null,
      triggeredBy: payload.triggeredBy ?? "schedule",
    })
    .returning({ id: syncRun.id });
  try {
    const stats = await fn();
    await db
      .update(syncRun)
      .set({ status: "success", finishedAt: new Date(), stats: stats ?? null })
      .where(eq(syncRun.id, run!.id));
    return stats;
  } catch (err) {
    await db
      .update(syncRun)
      .set({
        status: "failed",
        finishedAt: new Date(),
        log: err instanceof Error ? (err.stack ?? err.message) : String(err),
      })
      .where(eq(syncRun.id, run!.id));
    throw err;
  }
}

async function activeSeasons(
  db: Db,
  payload: JobPayload,
  statuses: SeasonStatus[]
): Promise<SeasonRef[]> {
  const all = await listSeasons(db, "all");
  const rows = await db
    .select({ id: leagueSeason.id, status: leagueSeason.status })
    .from(leagueSeason)
    .where(
      payload.leagueSeasonId
        ? eq(leagueSeason.id, payload.leagueSeasonId)
        : inArray(leagueSeason.status, statuses)
    );
  const ids = new Set(rows.map((r) => r.id));
  return all.filter((s) => s.source === "sleeper" && ids.has(s.id));
}

export function createHandlers(
  ctx: JobContext
): Record<JobName, (payload: JobPayload) => Promise<unknown>> {
  const { db, client } = ctx;
  const changed = async (id: number) => ctx.onSeasonChanged?.(id);

  return {
    // Current week's scores for in-progress seasons; feeds the Matchups page only (records never read it).
    live: (payload) =>
      tracked(db, "live", payload, async () => {
        const seasons = await activeSeasons(db, payload, ["in_season", "post_season"]);
        for (const s of seasons)
          await runSeasonPipeline(db, client, s, { mode: "live", derive: false });
        return { seasons: seasons.length };
      }),

    // Player info, NFL state, rosters, transactions, traded picks, draft, team names.
    daily: (payload) =>
      tracked(db, "daily", payload, async () => {
        await syncPlayers(db, client, hours(20));
        const seasons = await activeSeasons(db, payload, [
          "pre_draft",
          "drafting",
          "in_season",
          "post_season",
        ]);
        // The sync resets team_week.result / margin on every week it touches; only derive writes them back, so
        // derive here or the home page superlatives stay empty until the next finalize.
        for (const s of seasons) {
          await runSeasonPipeline(db, client, s, { mode: "daily", derive: false });
          await deriveSeason(db, s.id);
          await changed(s.id);
        }
        // Housekeeping must never fail the sync: old cached record responses (see prune.ts).
        const cachePruned = await pruneRecordCache(db).catch((err) => {
          log.warn({ err: String(err) }, "record cache prune failed");
          return 0;
        });
        return { seasons: seasons.length, cachePruned };
      }),

    // Re-fetches completed weeks (stat corrections), re-derives and bumps data_version. Safe to re-run.
    finalize: (payload) =>
      tracked(db, "finalize", payload, async () => {
        const seasons = await activeSeasons(db, payload, ["in_season", "post_season"]);
        for (const s of seasons) {
          await runSeasonPipeline(db, client, s, { mode: "full", force: true, derive: false });
          await syncNflReference(db, { seasons: [s.year], force: false });
          await deriveSeason(db, s.id);
          await changed(s.id);
        }
        return { seasons: seasons.length };
      }),

    "nfl-reference": (payload) =>
      tracked(db, "nfl_reference", payload, async () => ({ ...(await syncNflReference(db, {})) })),

    // Pick up league seasons Sleeper created since our newest one and ingest them.
    "season-rollover": (payload) =>
      tracked(db, "season_rollover", payload, async () => {
        const created = await seasonRollover(db, client);
        const all = await listSeasons(db, "all");
        for (const id of created) {
          const s = all.find((x) => x.id === id);
          if (!s) continue;
          await runSeasonPipeline(db, client, s, { mode: "full", derive: false });
          await syncNflReference(db, { seasons: [s.year] });
          await deriveSeason(db, s.id);
          await changed(s.id);
        }
        return { created };
      }),

    // Re-derive one season (or every stale/all season). Admin "recompute" and derive-version bumps land here.
    recompute: (payload) =>
      tracked(db, "recompute", payload, async () => {
        const seasons = payload.leagueSeasonId
          ? (await listSeasons(db, "all")).filter((s) => s.id === payload.leagueSeasonId)
          : await staleSeasons(db);
        for (const s of seasons) {
          if (payload.renormalize && s.source === "sleeper")
            await runSeasonPipeline(db, client, s, { mode: "full" });
          else if (payload.renormalize && s.source === "espn") await importEspnSeason(db, s.id);
          else await deriveSeason(db, s.id);
          await changed(s.id);
        }
        return { seasons: seasons.map((s) => s.id) };
      }),

    // A scraped ESPN bundle was uploaded: normalize the newest stored bundle for the season, then derive.
    "import-espn": (payload) =>
      tracked(db, "import_espn", payload, async () => {
        if (payload.leagueSeasonId === undefined)
          throw new Error("import-espn needs leagueSeasonId");
        const summary = await importEspnSeason(db, payload.leagueSeasonId);
        await syncNflReference(db, { seasons: [summary.year] });
        await deriveSeason(db, payload.leagueSeasonId);
        await changed(payload.leagueSeasonId);
        return { ...summary, derive: undefined } as unknown as Record<string, unknown>;
      }),

    // An admin added a Sleeper league season: bootstrap it, then ingest everything.
    "add-season": (payload) =>
      tracked(db, "backfill", payload, async () => {
        if (payload.leagueId === undefined || !payload.externalId)
          throw new Error("add-season needs leagueId and externalId");
        const id = await bootstrapSleeperSeason(db, client, {
          leagueId: payload.leagueId,
          externalId: payload.externalId,
        });
        const s = (await listSeasons(db, "all")).find((x) => x.id === id);
        if (s) {
          await runSeasonPipeline(db, client, s, { mode: "full", derive: false });
          await syncNflReference(db, { seasons: [s.year] });
          await deriveSeason(db, s.id);
          await changed(s.id);
        }
        return { leagueSeasonId: id };
      }),
  };
}

/** Seasons whose derived data was produced by older derive code (or never derived). */
export async function staleSeasons(db: Db): Promise<SeasonRef[]> {
  const all = await listSeasons(db, "all");
  const versions = await db
    .select({ id: leagueSeason.id })
    .from(leagueSeason)
    .leftJoin(dataVersion, eq(dataVersion.leagueSeasonId, leagueSeason.id))
    .where(
      or(sql`${dataVersion.leagueSeasonId} is null`, lt(dataVersion.deriveVersion, DERIVE_VERSION))
    );
  const ids = new Set(versions.map((v) => v.id));
  log.debug({ stale: [...ids] }, "stale seasons");
  return all.filter((s) => ids.has(s.id));
}
