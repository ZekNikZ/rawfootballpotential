import { randomBytes } from "node:crypto";
import pg from "pg";

/** Creates a throwaway database on the server DATABASE_URL points at, and returns its URL + a dropper. */
export async function createTempDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required for db integration tests");
  const name = `rfp_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(base);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      const c = new pg.Client({ connectionString: base });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}
