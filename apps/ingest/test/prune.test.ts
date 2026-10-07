import { recordCache, sql, type Db } from "@rfp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pruneRecordCache } from "../src/jobs/prune";
import { createTempDb } from "../src/testing/temp-db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTempDb());
});
afterAll(async () => {
  await close?.();
});

describe("pruneRecordCache", () => {
  it("deletes only rows older than the cut-off", async () => {
    const row = (recordId: string, daysOld: number) => ({
      recordId,
      paramsHash: "p",
      versionKey: "v",
      payload: {},
      computedAt: sql`now() - make_interval(days => ${daysOld})`,
    });
    await db
      .insert(recordCache)
      .values([row("fresh", 1), row("edge", 29), row("old", 31), row("older", 90)]);
    expect(await pruneRecordCache(db, 30)).toBe(2);
    const left = (await db.select({ id: recordCache.recordId }).from(recordCache))
      .map((r) => r.id)
      .sort();
    expect(left).toEqual(["edge", "fresh"]);
    expect(await pruneRecordCache(db, 30)).toBe(0);
  });
});
