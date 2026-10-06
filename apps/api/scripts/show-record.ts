// Prints one record's top rows from the dev database (no cache). Usage:
//   pnpm --filter @rfp/api show-record <record id> [--league dynasty] [key=value ...]
import { createDb, league, eq, loadEnvFile } from "@rfp/db";
import { runRecord } from "../src/records/run";

loadEnvFile();
const args = process.argv.slice(2);
const id = args.shift();
if (!id) throw new Error("usage: show-record <record id> [--league slug] [key=value ...]");
let slug = "redraft";
const query: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--league") slug = args[++i]!;
  else {
    const [k, ...v] = a.split("=");
    query[k!] = v.join("=");
  }
}
const { db, pool } = createDb(process.env.DATABASE_URL!);
const [l] = await db.select({ id: league.id }).from(league).where(eq(league.slug, slug));
if (!l) throw new Error(`no league ${slug}`);
const started = Date.now();
const res = await runRecord(db, l.id, id, { limit: "10", ...query }, { noCache: true });
const name = (r: (typeof res.rows)[number]) => {
  const t = r.refs.teamSeasonId ? res.entities.teamSeasons[r.refs.teamSeasonId] : undefined;
  const f = r.refs.franchiseId ? res.entities.franchises[r.refs.franchiseId] : undefined;
  return t?.name ?? f?.teamName ?? "";
};
console.log(
  `${res.meta.title} [${slug}] total=${res.total} seasons=${res.seasonsIncluded.join(",")} ${Date.now() - started}ms`
);
for (const r of res.rows)
  console.log(String(r.rank).padStart(3), name(r).padEnd(28), JSON.stringify(r.values));
await pool.end();
