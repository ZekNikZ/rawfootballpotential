import { writeFileSync } from "node:fs";
import { createDb } from "@rfp/db";
import { PgBoss } from "pg-boss";
import { createHandlers, jobPayload, type JobName } from "./jobs/handlers";
import { loadEnv } from "./lib/env";
import { log } from "./lib/log";
import { RawStore } from "./lib/raw-store";
import { SleeperClient } from "./sleeper/client";

// Cron expressions run in TZ (America/New_York): NFL game windows, not UTC.
const SCHEDULES: Record<JobName, string[]> = {
  // every 5 minutes through Thursday night, Saturday, Sunday and Monday night game windows
  live: [
    "*/5 20-23 * * 4",
    "*/5 0-1 * * 5",
    "*/5 13-23 * * 6",
    "*/5 0-1 * * 0",
    "*/5 12-23 * * 0",
    "*/5 0-1,20-23 * * 1",
    "*/5 0-1 * * 2",
  ],
  daily: ["0 5 * * *"],
  // Tuesday morning, with a Wednesday re-run to pick up stat corrections
  finalize: ["0 6 * * 2", "0 6 * * 3"],
  "nfl-reference": ["30 5 * * *"],
  "season-rollover": ["0 7 * * *"],
  recompute: [],
  "add-season": [],
  "import-espn": [],
};

async function main() {
  const env = loadEnv();
  const { db, pool } = createDb(env.DATABASE_URL, { max: 5 });
  const client = new SleeperClient(new RawStore(db));
  const handlers = createHandlers({ db, client });

  const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });
  boss.on("error", (err) => log.error({ err: String(err) }, "pg-boss error"));
  await boss.start();

  for (const name of Object.keys(handlers) as JobName[]) {
    await boss.createQueue(name);
    await boss.work(name, { localConcurrency: 1 }, async (jobs) => {
      for (const job of jobs) {
        const payload = jobPayload.parse(job.data ?? {});
        log.info({ job: name, id: job.id }, "job started");
        await handlers[name](payload);
        log.info({ job: name, id: job.id }, "job finished");
      }
    });
    if (env.INGEST_SCHEDULES_ENABLED) {
      const crons = SCHEDULES[name];
      for (const [i, cron] of crons.entries())
        await boss.schedule(name, cron, {}, { tz: env.TZ, key: `${name}-${i}` });
    }
  }

  // Derived tables built by older derive code are recomputed on startup.
  await boss.send("recompute", {});
  log.info({ schedules: env.INGEST_SCHEDULES_ENABLED }, "ingest worker started");

  // Heartbeat for the container healthcheck (docker-compose.yml): the file is touched only while the database answers.
  const heartbeatFile = process.env.HEARTBEAT_FILE ?? "/tmp/ingest-alive";
  const beat = async () => {
    try {
      await pool.query("select 1");
      writeFileSync(heartbeatFile, String(Date.now()));
    } catch (err) {
      log.warn({ err: String(err) }, "heartbeat failed");
    }
  };
  await beat();
  const heartbeat = setInterval(() => void beat(), 30_000);

  const shutdown = async () => {
    clearInterval(heartbeat);
    log.info("shutting down");
    await boss.stop({ graceful: true });
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? (err.stack ?? err.message) : String(err) },
    "worker failed to start"
  );
  process.exit(1);
});
