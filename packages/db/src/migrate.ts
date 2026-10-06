// Entrypoint of the one-shot `migrate` container (dist/migrate.js) and `pnpm db:migrate`.
// Importing this file runs the migrations, so libraries must import ./migrator instead.
import { loadEnvFile } from "./env";
import { runMigrations } from "./migrator";

if (!process.env.DATABASE_URL) loadEnvFile();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
runMigrations(url).then(
  () => console.log("migrations applied"),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
);
