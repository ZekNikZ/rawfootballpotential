import { sql } from "drizzle-orm";
import { dataVersion } from "./schema";
import type { Db } from "./client";

/**
 * Bump `data_version` for seasons whose served data changed without a re-derive (config edits: enable/disable,
 * data flags, manager names, franchise mapping). Record caches are keyed on it, so they refresh on next read.
 */
export async function bumpDataVersion(db: Db, leagueSeasonIds: readonly number[]): Promise<void> {
  for (const id of new Set(leagueSeasonIds)) {
    await db
      .insert(dataVersion)
      .values({ leagueSeasonId: id, version: 1 })
      .onConflictDoUpdate({
        target: dataVersion.leagueSeasonId,
        set: { version: sql`${dataVersion.version} + 1`, updatedAt: new Date() },
      });
  }
}
