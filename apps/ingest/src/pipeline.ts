import { league, leagueSeason, and, asc, eq, type Db } from "@rfp/db";
import { deriveSeason, type DeriveSummary } from "./derive/derive";
import type { SleeperClient } from "./sleeper/client";
import { syncSleeperSeason, type SyncMode, type SyncSummary } from "./sleeper/sync";

export interface SeasonRef {
  id: number;
  slug: string;
  year: number;
  source: "sleeper" | "espn";
}

export async function listSeasons(db: Db, filter?: string): Promise<SeasonRef[]> {
  const rows = await db
    .select({
      id: leagueSeason.id,
      slug: league.slug,
      year: leagueSeason.year,
      source: leagueSeason.source,
    })
    .from(leagueSeason)
    .innerJoin(league, eq(league.id, leagueSeason.leagueId))
    .where(and(eq(leagueSeason.enabled, true), eq(league.enabled, true)))
    .orderBy(asc(league.displayOrder), asc(leagueSeason.year));
  if (!filter || filter === "all") return rows;
  return rows.filter((r) => `${r.slug}-${r.year}` === filter || r.slug === filter);
}

export interface PipelineResult {
  season: SeasonRef;
  sync?: SyncSummary;
  derive?: DeriveSummary;
}

/** raw -> normalize -> (NFL reference fill, separate job) -> derive -> data_version bump. */
export async function runSeasonPipeline(
  db: Db,
  client: SleeperClient,
  season: SeasonRef,
  opts: { mode: SyncMode; force?: boolean; derive?: boolean }
): Promise<PipelineResult> {
  const result: PipelineResult = { season };
  if (season.source === "sleeper") {
    result.sync = await syncSleeperSeason(db, client, season.id, {
      mode: opts.mode,
      force: opts.force ?? false,
    });
  }
  if (opts.derive !== false) result.derive = await deriveSeason(db, season.id);
  return result;
}
