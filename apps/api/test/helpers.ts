import type { Db } from "@rfp/db";
import { createTempDb, seedFixtureLeagues, type SeededFixture } from "@rfp/ingest/testing";
import type { RecordResponse } from "../src/records/run";
import { runRecord } from "../src/records/run";

export interface World {
  db: Db;
  fixture: SeededFixture;
  leagueId: number;
  run: (id: string, query?: Record<string, unknown>) => Promise<RecordResponse>;
  /** "Team 3" style label of a row's team (that season's team name). */
  team: (res: RecordResponse, row: RecordResponse["rows"][number]) => string;
  close: () => Promise<void>;
}

/** A migrated throwaway database seeded with the two fixture seasons through the real pipeline. */
export async function createWorld(): Promise<World> {
  const temp = await createTempDb();
  const fixture = await seedFixtureLeagues(temp.db);
  return {
    db: temp.db,
    fixture,
    leagueId: fixture.leagueId,
    run: (id, query = {}) => runRecord(temp.db, fixture.leagueId, id, query, { noCache: true }),
    team: (res, row) => {
      const ts = row.refs.teamSeasonId
        ? res.entities.teamSeasons[row.refs.teamSeasonId]
        : undefined;
      if (ts) return ts.name;
      const f = row.refs.franchiseId ? res.entities.franchises[row.refs.franchiseId] : undefined;
      return f?.teamName ?? "?";
    },
    close: async () => {
      fixture.restore();
      await temp.close();
    },
  };
}
