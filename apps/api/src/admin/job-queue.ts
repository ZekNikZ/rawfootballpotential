import { PgBoss } from "pg-boss";
import type { JobQueue } from "./context";

/** Send-only pg-boss client: the ingest worker owns the queues and runs the jobs. */
export function createPgBossQueue(
  connectionString: string
): JobQueue & { stop: () => Promise<void> } {
  let boss: PgBoss | null = null;
  const started = new Set<string>();
  const ready = async () => {
    if (!boss) {
      boss = new PgBoss({ connectionString, schema: "pgboss" });
      boss.on("error", () => {});
      await boss.start();
    }
    return boss;
  };
  return {
    async send(name, data) {
      const b = await ready();
      if (!started.has(name)) {
        await b.createQueue(name);
        started.add(name);
      }
      return b.send(name, data);
    },
    async stop() {
      if (boss) await boss.stop({ graceful: true });
    },
  };
}
