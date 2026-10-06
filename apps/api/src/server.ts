import { createDb } from "@rfp/db";
import { buildApp } from "./app";
import type { AdminDeps } from "./admin/context";
import { createPgBossQueue } from "./admin/job-queue";
import { createAuth } from "./auth/auth";
import { loadConfig } from "./config";
import { watchDataVersion } from "./records/prewarm";

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL, { max: 10 });
const jobs = createPgBossQueue(config.DATABASE_URL);
const allowedOrigins = [config.PUBLIC_URL, ...config.EXTRA_ORIGINS];
let admin: AdminDeps | undefined;
if (config.BETTER_AUTH_SECRET) {
  admin = {
    db,
    auth: createAuth(db, {
      secret: config.BETTER_AUTH_SECRET,
      origin: config.PUBLIC_URL,
      extraOrigins: config.EXTRA_ORIGINS,
      secureCookies: config.PUBLIC_URL.startsWith("https://"),
    }),
    jobs,
    origin: config.PUBLIC_URL,
    allowedOrigins,
  };
}
const app = buildApp({
  db,
  config,
  logger: { level: config.LOG_LEVEL },
  ...(admin ? { admin } : {}),
});
if (!admin) app.log.warn("BETTER_AUTH_SECRET is not set: the admin API is disabled");

const stopWatching = watchDataVersion(db, app.log);

const shutdown = async () => {
  stopWatching();
  await app.close();
  await jobs.stop();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

app.listen({ port: config.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error({ err }, "failed to start");
  process.exit(1);
});
