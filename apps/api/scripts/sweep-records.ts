// Runs every record in the catalog against the dev database with a handful of filter combinations and reports
// errors and timings. Usage: pnpm --filter @rfp/api sweep-records [id-prefix]
import { RECORD_CATALOG, SORTABLE_COLUMN_TYPES } from "@rfp/core";
import { createDb, league, loadEnvFile } from "@rfp/db";
import { runRecord } from "../src/records/run";

loadEnvFile();
const prefix = process.argv[2] ?? "";
const { db, pool } = createDb(process.env.DATABASE_URL!);
const leagues = await db.select({ id: league.id, slug: league.slug }).from(league);
const combos: Record<string, unknown>[] = [
  {},
  { scope: "playoffs" },
  { scope: "regular", onePer: "season" },
  { scope: "toilet_bowl" },
  { seasons: "2024-2025", onePer: "franchise" },
  { weeks: "3-6", median: "exclude" },
  { limit: 200, minGames: 1 },
];
let failures = 0;
let runs = 0;
let slowest = { ms: 0, label: "" };
for (const def of RECORD_CATALOG.filter((r) => r.id.startsWith(prefix))) {
  // Every sortable column both ways, as the table headers send it.
  const sorts = def.columns
    .filter((col) => SORTABLE_COLUMN_TYPES.has(col.type))
    .flatMap((col) => (["asc", "desc"] as const).map((dir) => ({ sort: col.key, dir })));
  for (const l of leagues) {
    for (const combo of [...combos, ...sorts]) {
      const started = Date.now();
      try {
        await runRecord(db, l.id, def.id, combo, { noCache: true });
      } catch (err) {
        failures++;
        console.log(
          `FAIL ${def.id} [${l.slug}] ${JSON.stringify(combo)}: ${String(err).slice(0, 200)}`
        );
      }
      const ms = Date.now() - started;
      runs++;
      if (ms > slowest.ms)
        slowest = { ms, label: `${def.id} [${l.slug}] ${JSON.stringify(combo)}` };
    }
  }
}
console.log(`${runs} runs, ${failures} failures, slowest ${slowest.ms} ms (${slowest.label})`);
await pool.end();
process.exitCode = failures ? 1 : 0;
