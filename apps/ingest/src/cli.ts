import { parseArgs } from "node:util";
import { createDb } from "@rfp/db";
import { loadEnv } from "./lib/env";
import { log } from "./lib/log";
import { RawStore, hours } from "./lib/raw-store";
import { deriveSeason } from "./derive/derive";
import { listSeasons, runSeasonPipeline } from "./pipeline";
import { SleeperClient } from "./sleeper/client";
import { syncPlayers } from "./sleeper/players";
import { seasonRollover } from "./sleeper/rollover";
import { syncNflReference } from "./nfl/reference";
import { buildReport, formatReport } from "./report";
import { importEspnFile } from "./espn/archive";
import { createHandlers, type JobName } from "./jobs/handlers";

const HELP = `usage: pnpm ingest <command> [options]

commands
  players                       refresh the Sleeper player dump (cached for a day)
  rollover                      discover newly created Sleeper league seasons
  sync [--season <slug-year|slug|all>] [--mode full|live|daily] [--force]
  derive [--season ...]         recompute derived tables
  nfl-reference [--seasons 2022,2023] [--force]
  all [--force]                 players, rollover, sync + nfl-reference + derive for every season
  job <name> [--season ...]     run a scheduled job now (live|daily|finalize|nfl-reference|season-rollover|recompute)
  espn <bundle> [--season slug-year]  archive a scraped ESPN bundle, normalize it, derive, print the import report
  report                        sanity report per season
`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      season: { type: "string" },
      seasons: { type: "string" },
      mode: { type: "string", default: "full" },
      force: { type: "boolean", default: false },
    },
  });
  if (!command || command === "help") {
    console.log(HELP);
    return;
  }
  const env = loadEnv();
  const { db, pool } = createDb(env.DATABASE_URL);
  const client = new SleeperClient(new RawStore(db), undefined, { force: values.force });
  try {
    const mode = values.mode as "full" | "live" | "daily";
    switch (command) {
      case "players":
        await syncPlayers(db, client, values.force ? hours(0) : hours(20));
        break;
      case "rollover":
        console.log(JSON.stringify(await seasonRollover(db, client)));
        break;
      case "sync":
        for (const s of await listSeasons(db, values.season)) {
          const r = await runSeasonPipeline(db, client, s, {
            mode,
            force: values.force,
            derive: false,
          });
          console.log(JSON.stringify(r.sync ?? { season: s, note: "not a Sleeper season" }));
        }
        break;
      case "derive":
        for (const s of await listSeasons(db, values.season))
          console.log(JSON.stringify(await deriveSeason(db, s.id)));
        break;
      case "nfl-reference": {
        const seasons = values.seasons?.split(",").map(Number);
        console.log(JSON.stringify(await syncNflReference(db, { seasons, force: values.force })));
        break;
      }
      case "all": {
        await syncPlayers(db, client, values.force ? hours(0) : hours(20));
        // Sync, then look for seasons Sleeper created since the newest one; repeat until nothing new appears.
        const done = new Set<number>();
        for (;;) {
          const pending = (await listSeasons(db, "all")).filter((s) => !done.has(s.id));
          for (const s of pending) {
            await runSeasonPipeline(db, client, s, {
              mode: "full",
              force: values.force,
              derive: false,
            });
            done.add(s.id);
          }
          if ((await seasonRollover(db, client)).length === 0) break;
        }
        await syncNflReference(db, { force: values.force });
        for (const s of await listSeasons(db, "all")) await deriveSeason(db, s.id);
        break;
      }
      case "job": {
        const name = rest[0] as JobName;
        const handlers = createHandlers({ db, client });
        if (!handlers[name]) throw new Error(`unknown job ${String(name)}`);
        const target = values.season ? (await listSeasons(db, values.season))[0] : undefined;
        await handlers[name]({
          ...(target ? { leagueSeasonId: target.id } : {}),
          triggeredBy: "cli",
        });
        break;
      }
      case "espn": {
        const file = rest[0];
        if (!file) throw new Error("usage: pnpm ingest espn <bundle.json.gz>");
        console.log(JSON.stringify(await importEspnFile(db, file), null, 2));
        break;
      }
      case "report":
        console.log(formatReport(await buildReport(db)));
        break;
      default:
        console.log(HELP);
        process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? (err.stack ?? err.message) : String(err) },
    "command failed"
  );
  process.exit(1);
});
