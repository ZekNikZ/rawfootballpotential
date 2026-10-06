import { dataVersion, league, eq, max } from "@rfp/db";
import type { Db } from "@rfp/db";
import { RECORD_CATALOG } from "@rfp/core";
import { runRecord } from "./run";

export interface PrewarmLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
}

/** Run every record's default view so the first visitor after a sync is served from the cache (doc §3.1). */
export async function prewarmLeague(db: Db, leagueId: number): Promise<number> {
  let warmed = 0;
  for (const def of RECORD_CATALOG) {
    // The web app asks for the whole table on manager records and a 25-row page on the others.
    const query = def.displayAll ? { limit: 200 } : {};
    await runRecord(db, leagueId, def.id, query);
    warmed++;
  }
  return warmed;
}

export async function prewarmAll(db: Db, log: PrewarmLogger): Promise<void> {
  const leagues = await db
    .select({ id: league.id, slug: league.slug })
    .from(league)
    .where(eq(league.enabled, true));
  for (const l of leagues) {
    try {
      log.info({ league: l.slug, records: await prewarmLeague(db, l.id) }, "record cache warmed");
    } catch (err) {
      log.warn({ league: l.slug, err: String(err) }, "pre-warm failed");
    }
  }
}

/**
 * The ingest worker runs in another process, so the API notices a finished sync by watching data_version: when any
 * season's version or timestamp moves, warm the caches in the background. Returns a stop function.
 */
export function watchDataVersion(db: Db, log: PrewarmLogger, intervalMs = 30_000): () => void {
  let last: string | null = null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const [row] = await db.select({ at: max(dataVersion.updatedAt) }).from(dataVersion);
      const stamp = row?.at?.toISOString() ?? "none";
      if (stamp !== last) {
        last = stamp;
        await prewarmAll(db, log);
      }
    } catch (err) {
      log.warn({ err: String(err) }, "data_version watch failed");
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
