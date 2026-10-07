import { createDb, loadEnvFile } from "@rfp/db";
import { prewarmAll } from "../src/records/prewarm";

loadEnvFile();
const { db, pool } = createDb(process.env.DATABASE_URL!);
const started = Date.now();
await prewarmAll(db, {
  info: (o, m) => console.log(m, JSON.stringify(o)),
  warn: (o, m) => console.warn(m, JSON.stringify(o)),
});
console.log(`done in ${Date.now() - started} ms`);
await pool.end();
