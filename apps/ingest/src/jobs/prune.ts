import { recordCache, lt, sql, type Db } from "@rfp/db";

/**
 * Deletes cached record responses computed more than `days` ago. The cache key hashes the data and metric versions, so
 * every bump leaves rows that can never match again; those are always older than the bump. Rows that are still valid
 * are simply recomputed on the next request (and by the pre-warm after the next sync).
 */
export async function pruneRecordCache(db: Db, days = 30): Promise<number> {
  const deleted = await db
    .delete(recordCache)
    .where(lt(recordCache.computedAt, sql`now() - make_interval(days => ${days})`))
    .returning({ recordId: recordCache.recordId });
  return deleted.length;
}
