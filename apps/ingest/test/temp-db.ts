import { randomBytes } from "node:crypto";
import { createDb, runMigrations, type Db } from "@rfp/db";
import pg from "pg";

/** A migrated throwaway database on the server DATABASE_URL points at. */
export async function createTempDb(): Promise<{ db: Db; url: string; close: () => Promise<void> }> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required for integration tests");
  const name = `rfp_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(base);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  const { db, pool } = createDb(url.toString(), { max: 4 });
  return {
    db,
    url: url.toString(),
    close: async () => {
      await pool.end();
      const c = new pg.Client({ connectionString: base });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}
