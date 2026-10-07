// Usage (on your desktop, not the server):
//   pnpm scrape:espn --year 2021                 scrape a season, write the bundle, print the data-gap report
//   pnpm scrape:espn discover --year 2021        record the API calls ESPN's own pages make while you click around
//   pnpm scrape:espn report <bundle.json.gz>     re-run the gap report on a saved bundle
// Options: --league redraft  --espn-league <id>  --out <dir>  --profile <dir>  --login (force the browser)
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { buildBundle, readBundle, writeBundle } from "./bundle";
import { discoverApis, loginInBrowser } from "./browser";
import {
  fetchOne,
  lastScoringPeriod,
  publicGetter,
  seasonRequest,
  SEASON_VIEWS,
  weekRequests,
  type EspnResponse,
  type Getter,
} from "./espn";
import { formatReport, gapReport } from "./gap-report";
import { KNOWN_LEAGUES } from "./leagues";

const here = fileURLToPath(new URL("..", import.meta.url));
const log = (msg: string) => console.log(msg);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function report(path: string) {
  const bundle = readBundle(path);
  console.log(formatReport(gapReport(bundle.manifest.year, bundle.responses)));
}

async function discover() {
  const year = Number(arg("year") ?? 2021);
  const leagueSlug = arg("league") ?? "redraft";
  const id = arg("espn-league") ?? KNOWN_LEAGUES[leagueSlug]?.[year];
  if (!id) throw new Error("no ESPN league id known; pass --espn-league");
  const start = `https://fantasy.espn.com/football/team?leagueId=${id}&seasonId=${year}&teamId=${arg("team") ?? 1}&scoringPeriodId=${arg("week") ?? 5}`;
  const profile = resolve(arg("profile") ?? resolve(here, "../../.espn-profile"));
  const calls = await discoverApis(profile, start, log);
  const path = resolve(
    arg("out") ?? resolve(here, "bundles"),
    `discovery-${leagueSlug}-${year}.json.gz`
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, gzipSync(Buffer.from(JSON.stringify(calls))));
  log(`Recorded ${calls.length} API calls to ${path}`);
  const shapes = new Map<string, number>();
  for (const c of calls) {
    const u = new URL(c.url);
    const key = `${u.pathname.split("/leagues/")[1] ?? u.pathname} ${u.searchParams.getAll("view").join("+")}${c.headers["x-fantasy-filter"] ? " [filter]" : ""}`;
    shapes.set(key, (shapes.get(key) ?? 0) + 1);
  }
  for (const [k, n] of shapes) log(`  ${n}x ${k}`);
}

async function scrape() {
  const year = Number(arg("year"));
  if (!Number.isInteger(year)) throw new Error("usage: pnpm scrape:espn --year 2021");
  const leagueSlug = arg("league") ?? "redraft";
  const espnLeagueId = arg("espn-league") ?? KNOWN_LEAGUES[leagueSlug]?.[year];
  if (!espnLeagueId)
    throw new Error(`no ESPN league id known for ${leagueSlug} ${year}; pass --espn-league`);
  const outDir = resolve(arg("out") ?? resolve(here, "bundles"));
  const profile = resolve(arg("profile") ?? resolve(here, "../../.espn-profile"));
  const path = resolve(outDir, `${leagueSlug}-${year}.json.gz`);
  if (existsSync(path) && !process.argv.includes("--force"))
    throw new Error(`${path} exists (it is irreplaceable); pass --force to scrape again`);

  const responses: EspnResponse[] = [];
  let get: Getter = publicGetter;
  let close: () => Promise<void> = async () => undefined;
  const opts = { log };

  // 1. Is the league public? If ESPN refuses, open the browser and wait for a manual login.
  const first = seasonRequest(year, espnLeagueId, "mSettings");
  let settings = process.argv.includes("--login") ? null : await fetchOne(get, first, opts);
  if (!settings || settings.status !== 200 || settings.payload === null) {
    log(settings ? `ESPN answered HTTP ${settings.status}: logging in.` : "Logging in.");
    const session = await loginInBrowser(profile, log);
    get = session.get;
    close = session.close;
    settings = await fetchOne(get, first, opts);
  } else log("The league is readable without logging in.");

  try {
    if (settings.status !== 200 || settings.payload === null)
      throw new Error(
        `mSettings failed (HTTP ${settings.status}); is ${espnLeagueId} the right league for ${year}?`
      );
    responses.push(settings);
    const last = lastScoringPeriod(settings.payload);
    log(`Season ${year}: ${last} scoring periods.`);

    // 2. Whole-season views, then every week.
    for (const v of SEASON_VIEWS.filter((v) => v.endpoint !== "mSettings")) {
      responses.push(await fetchOne(get, seasonRequest(year, espnLeagueId, v.endpoint), opts));
      log(`  ${v.endpoint}: HTTP ${responses.at(-1)!.status}`);
    }
    for (let week = 1; week <= last; week++) {
      for (const req of weekRequests(year, espnLeagueId, week))
        responses.push(await fetchOne(get, req, opts));
      log(`  week ${week} done`);
    }
  } catch (err) {
    // Keep what was fetched: a partial bundle is better than starting over.
    if (responses.length) {
      const partial = path.replace(/\.json\.gz$/, ".partial.json.gz");
      writeBundle(partial, buildBundle({ league: leagueSlug, year, espnLeagueId }, responses));
      log(`Failed part-way; saved ${responses.length} responses to ${partial}`);
    }
    throw err;
  } finally {
    await close();
  }

  const bundle = buildBundle({ league: leagueSlug, year, espnLeagueId }, responses);
  const bytes = writeBundle(path, bundle);
  log(`\nBundle: ${path} (${(bytes / 1024 / 1024).toFixed(1)} MB, ${responses.length} responses)`);
  log(
    "Keep a copy somewhere safe (the S3 bucket): ESPN data for past seasons may not stay available.\n"
  );
  const rep = gapReport(year, responses);
  console.log(formatReport(rep));
  writeFileSync(path.replace(/\.json\.gz$/, ".gaps.json"), JSON.stringify(rep, null, 2));
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "report") {
    if (!rest[0]) throw new Error("usage: pnpm scrape:espn report <bundle>");
    await report(rest[0]);
  } else if (command === "discover") await discover();
  else await scrape();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
