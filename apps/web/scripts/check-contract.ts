// Fetches every endpoint the web app uses from a running API and parses it with the app's zod schemas.
// Usage: pnpm --filter @rfp/web check:contract [http://localhost:8000]
import type { z } from "zod";
import {
  blogResponse,
  draftsResponse,
  catalogResponse,
  franchiseProfileResponse,
  franchisesResponse,
  h2hResponse,
  leaguesResponse,
  matchupsResponse,
  picksResponse,
  recordResponse,
  siteResponse,
  standingsResponse,
  teamsResponse,
  transactionsResponse,
  trophiesResponse,
} from "../src/api/schemas";

const base = process.argv[2] ?? "http://localhost:8000";
let failures = 0;

async function check<T extends z.ZodType>(path: string, schema: T): Promise<z.output<T> | null> {
  const res = await fetch(base + path);
  if (!res.ok) {
    console.log(`FAIL ${path}: HTTP ${res.status}`);
    failures++;
    return null;
  }
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    console.log(
      `FAIL ${path}: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
    failures++;
    return null;
  }
  console.log(`ok   ${path}`);
  return parsed.data;
}

const leagues = (await check("/api/leagues", leaguesResponse))?.leagues ?? [];
await check("/api/site", siteResponse);
await check("/api/blog", blogResponse);
for (const lg of leagues) {
  const catalog = await check(`/api/leagues/${lg.slug}/records`, catalogResponse);
  for (const rec of catalog?.records ?? [])
    await check(`/api/leagues/${lg.slug}/records/${rec.id}?limit=3`, recordResponse);
  await check(`/api/leagues/${lg.slug}/h2h`, h2hResponse);
  await check(`/api/leagues/${lg.slug}/trophies`, trophiesResponse);
  const fr = await check(`/api/leagues/${lg.slug}/franchises`, franchisesResponse);
  for (const id of fr?.franchises ?? [])
    await check(`/api/leagues/${lg.slug}/franchises/${id}`, franchiseProfileResponse);
  await check(`/api/leagues/${lg.slug}/picks`, picksResponse);
  // Every season, not just the latest: the ESPN years have no lineups, transactions or drafts.
  for (const season of lg.seasons) {
    await check(`/api/seasons/${season.id}/standings`, standingsResponse);
    await check(`/api/seasons/${season.id}/matchups?players=true`, matchupsResponse);
    await check(`/api/seasons/${season.id}/teams?rosters=true`, teamsResponse);
    await check(`/api/seasons/${season.id}/transactions?limit=25`, transactionsResponse);
    await check(`/api/seasons/${season.id}/draft`, draftsResponse);
  }
}
console.log(failures === 0 ? "contract OK" : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
