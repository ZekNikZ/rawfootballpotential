import { createDb } from "@rfp/db";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { watchDataVersion } from "./records/prewarm";

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL, { max: 10 });
const app = buildApp({ db, config, logger: { level: config.LOG_LEVEL } });

const stopWatching = watchDataVersion(db, app.log);

const shutdown = async () => {
  stopWatching();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

app.listen({ port: config.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error({ err }, "failed to start");
  process.exit(1);
});
