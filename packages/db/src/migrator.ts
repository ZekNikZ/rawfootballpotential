import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client";

/**
 * Applies the committed SQL migrations. Idempotent. The default folder sits next to src/ and dist/
 * (`packages/db/migrations`); callers bundled elsewhere pass their own.
 */
export async function runMigrations(
  connectionString: string,
  migrationsFolder?: string
): Promise<void> {
  const { db, pool } = createDb(connectionString, { max: 1 });
  try {
    await migrate(db, {
      migrationsFolder:
        migrationsFolder ?? fileURLToPath(new URL("../migrations", import.meta.url)),
    });
  } finally {
    await pool.end();
  }
}
