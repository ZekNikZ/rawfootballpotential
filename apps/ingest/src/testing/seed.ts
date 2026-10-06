import { league, leagueThreshold, type Db } from "@rfp/db";
import { deriveSeason } from "../derive/derive";
import { RateLimiter, RawStore, hours } from "../lib/raw-store";
import { SleeperClient } from "../sleeper/client";
import { syncPlayers } from "../sleeper/players";
import { bootstrapSleeperSeason, syncSleeperSeason } from "../sleeper/sync";
import { FIXTURE_2030, FIXTURE_2031, fixtureRoute, type FixtureSeason } from "./fixture-league";

/** Replaces global fetch with a fake Sleeper API; `restore()` puts the real one back. */
export function installFakeFetch(route: (url: string) => unknown | undefined) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const body = route(url);
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export interface SeededFixture {
  leagueId: number;
  /** year -> league_season.id */
  seasonIds: Record<number, number>;
  client: SleeperClient;
  fetchCalls: string[];
  /** Puts the real fetch back (call in afterAll). */
  restore: () => void;
}

/**
 * Runs the fixture leagues through the real pipeline (fetch -> raw cache -> normalize -> derive) so tests exercise
 * exactly what production runs. The league is `fx` (redraft); trophy thresholds are 125 / 65.
 */
export async function seedFixtureLeagues(
  db: Db,
  seasons: readonly FixtureSeason[] = [FIXTURE_2030, FIXTURE_2031]
): Promise<SeededFixture> {
  const fake = installFakeFetch(fixtureRoute(seasons));
  const client = new SleeperClient(new RawStore(db), new RateLimiter(1_000_000));
  const [lg] = await db
    .insert(league)
    .values({ slug: "fx", name: "Fixture", type: "redraft", color: "blue" })
    .returning();
  await db.insert(leagueThreshold).values([
    { leagueId: lg!.id, key: "high_scorer", value: 125 },
    { leagueId: lg!.id, key: "benchwarmer", value: 65 },
  ]);
  await syncPlayers(db, client, hours(1));
  const seasonIds: Record<number, number> = {};
  for (const s of [...seasons].sort((a, b) => a.year - b.year)) {
    const id = await bootstrapSleeperSeason(db, client, {
      leagueId: lg!.id,
      externalId: s.leagueId,
    });
    await syncSleeperSeason(db, client, id, { mode: "full" });
    await deriveSeason(db, id);
    seasonIds[s.year] = id;
  }
  return { leagueId: lg!.id, seasonIds, client, fetchCalls: fake.calls, restore: fake.restore };
}
