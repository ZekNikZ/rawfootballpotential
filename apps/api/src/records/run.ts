import { createHash } from "node:crypto";
import { dataVersion, leagueSeason, recordCache, and, eq, sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import {
  FILTER_KEYS,
  getRecordDef,
  queryKey,
  recordQuerySchema,
  selectSeasons,
  type RecordDef,
  type RecordQuery,
  type Requirement,
} from "@rfp/core";
import type { RankedRow, RunContext } from "./context";
import {
  careerLineupsRecord,
  careerPlacementsRecord,
  careerScoringRecord,
  careerStandingsRecord,
  careerTransactionsRecord,
} from "./engines/career";
import { playerSeasonRecord, playerWeekRecord } from "./engines/players";
import { teamWeekRecord, uncountedRecord } from "./engines/team-week";
import {
  draftRetentionRecord,
  seasonTransactionsRecord,
  teamSeasonRecord,
} from "./engines/team-season";
import {
  draftPriceRecord,
  faabClaimRecord,
  mostMovedRecord,
  tradeRecord,
} from "./engines/transactions";
import {
  allPlayRecord,
  draftClassRecord,
  scheduleSwapRecord,
  seedFinishRecord,
  trajectoryRecord,
  weeklyCountsRecord,
} from "./engines/season-extra";
import {
  careerMarginsRecord,
  careerDifferentialRecord,
  careerRegretRecord,
  careerRunsRecord,
  careerWeeklyRecord,
  rivalryRecord,
} from "./engines/career-extra";
import {
  dropRegretRecord,
  draftValueRecord,
  journeymanRecord,
  loyaltyRecord,
  nflStackRecord,
  pickupRecord,
  playerProjectionRecord,
  tradeValueRecord,
} from "./engines/player-extra";
import { careerPowerRecord } from "./engines/power";
import { extraTeamWeekRecord } from "./engines/team-week-extra";
import { resolveRows, type Entities, type ResolvedRow } from "./entities";
import { minGames } from "./engines/season-base";

/**
 * Bump when the shape of every record response changes; old cache rows then stop matching. A change to one record is
 * a bump of that record's `version` in the catalog instead.
 */
export const RESPONSE_VERSION = 1;

const ENGINES: Record<string, (ctx: RunContext) => Promise<RankedRow[]>> = {
  teamWeek: teamWeekRecord,
  uncounted: uncountedRecord,
  teamSeason: teamSeasonRecord,
  seasonTransactions: seasonTransactionsRecord,
  draftRetention: draftRetentionRecord,
  careerStandings: careerStandingsRecord,
  careerPlacements: careerPlacementsRecord,
  careerLineups: careerLineupsRecord,
  careerScoring: careerScoringRecord,
  careerTransactions: careerTransactionsRecord,
  playerWeek: playerWeekRecord,
  playerSeason: playerSeasonRecord,
  faabClaim: faabClaimRecord,
  draftPrice: draftPriceRecord,
  mostMoved: mostMovedRecord,
  trade: tradeRecord,
  extraTeamWeek: extraTeamWeekRecord,
  playerProjection: playerProjectionRecord,
  nflStack: nflStackRecord,
  allPlay: allPlayRecord,
  scheduleSwap: scheduleSwapRecord,
  weeklyCounts: weeklyCountsRecord,
  seedFinish: seedFinishRecord,
  trajectory: trajectoryRecord,
  draftClass: draftClassRecord,
  pickup: pickupRecord,
  dropRegret: dropRegretRecord,
  tradeValue: tradeValueRecord,
  journeyman: journeymanRecord,
  loyalty: loyaltyRecord,
  draftValue: draftValueRecord,
  careerRegret: careerRegretRecord,
  careerMargins: careerMarginsRecord,
  careerDifferential: careerDifferentialRecord,
  careerWeekly: careerWeeklyRecord,
  careerRuns: careerRunsRecord,
  careerPower: careerPowerRecord,
  rivalry: rivalryRecord,
};

const REQUIREMENT_FLAG: Record<Requirement, keyof typeof leagueSeason.$inferSelect> = {
  playerData: "hasPlayerData",
  projections: "hasProjections",
  transactions: "hasTransactions",
  draft: "hasDraft",
  faab: "hasFaab",
  auctionDraft: "hasAuctionDraft",
};

export interface RecordResponse {
  meta: {
    id: string;
    title: string;
    category: RecordDef["category"];
    section: string;
    grain: RecordDef["grain"];
    direction: "asc" | "desc";
    sortKey: string;
    columns: RecordDef["columns"];
    active: RecordDef["active"];
    requires: RecordDef["requires"];
    displayAll: boolean;
    /** Minimum games applied, when the record has a qualifier. */
    qualifier: { minGames: number } | null;
  };
  /** The normalized query that produced this response (presets applied, unsupported filters reset). */
  params: RecordQuery;
  rows: ResolvedRow[];
  total: number;
  entities: Entities;
  dataVersion: string;
  /** First season whose data satisfies the record's requirements. */
  availableFrom: number | null;
  /** Seasons the response covers. */
  seasonsIncluded: number[];
}

export class RecordError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** Validate a raw query string against the record: defaults, presets applied, unsupported filters reset. */
export function normalizeForRecord(def: RecordDef, raw: Record<string, unknown>): RecordQuery {
  const parsed = recordQuerySchema.safeParse({ ...(def.defaults ?? {}), ...raw });
  if (!parsed.success)
    throw new RecordError(
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
  const defaults = recordQuerySchema.parse({});
  const q: Record<string, unknown> = { ...parsed.data };
  for (const key of FILTER_KEYS) {
    if (!def.filters.includes(key)) q[key] = (defaults as Record<string, unknown>)[key];
  }
  for (const [key, value] of Object.entries(def.preset ?? {})) q[key] = value;
  return q as RecordQuery;
}

async function eligibleSeasons(db: Db, leagueId: number, def: RecordDef, q: RecordQuery) {
  const all = await db
    .select()
    .from(leagueSeason)
    .where(and(eq(leagueSeason.leagueId, leagueId), eq(leagueSeason.enabled, true)));
  const meets = (s: (typeof all)[number]) =>
    def.requires.every((r) => s[REQUIREMENT_FLAG[r]] === true);
  const satisfying = all.filter(meets);
  const years = selectSeasons(
    q.seasons,
    satisfying.map((s) => s.year)
  );
  const picked = satisfying.filter(
    (s) => years.includes(s.year) && (def.active !== "complete_only" || s.status === "complete")
  );
  return {
    seasonIds: picked.map((s) => s.id),
    years: picked.map((s) => s.year).sort((a, b) => a - b),
    availableFrom: satisfying.length ? Math.min(...satisfying.map((s) => s.year)) : null,
    allSeasonIds: all.map((s) => s.id),
  };
}

async function versionKey(
  db: Db,
  seasonIds: readonly number[],
  metricVersion: number
): Promise<string> {
  const rows = seasonIds.length
    ? await db
        .select({ id: dataVersion.leagueSeasonId, version: dataVersion.version })
        .from(dataVersion)
        .where(
          sql`${dataVersion.leagueSeasonId} in (${sql.join(
            seasonIds.map((i) => sql`${i}`),
            sql`, `
          )})`
        )
    : [];
  const parts = [...seasonIds]
    .sort((a, b) => a - b)
    .map((id) => `${id}:${rows.find((r) => r.id === id)?.version ?? 0}`);
  return createHash("sha1")
    .update(`${RESPONSE_VERSION}|${metricVersion}|${parts.join(",")}`)
    .digest("hex")
    .slice(0, 16);
}

export interface RunOptions {
  /** Skip the response cache (tests). */
  noCache?: boolean;
}

/**
 * Run one record for a league. Responses are cached by (record, normalized params, version key), where the version
 * key hashes the response version, the record's own `version` and the data_versions of the seasons the query reads, so a
 * data change in those seasons or a bump of the record's version invalidates it (doc §3.1).
 */
export async function runRecord(
  db: Db,
  leagueId: number,
  recordId: string,
  rawQuery: Record<string, unknown>,
  options: RunOptions = {}
): Promise<RecordResponse> {
  const def = getRecordDef(recordId);
  if (!def) throw new RecordError(404, `unknown record ${recordId}`);
  const q = normalizeForRecord(def, rawQuery);
  const eligible = await eligibleSeasons(db, leagueId, def, q);
  const version = await versionKey(
    db,
    def.readsAllSeasons ? eligible.allSeasonIds : eligible.seasonIds,
    def.version ?? 1
  );
  const paramsHash = createHash("sha1")
    .update(`${leagueId}|${queryKey(q)}`)
    .digest("hex")
    .slice(0, 16);

  if (!options.noCache) {
    const [hit] = await db
      .select({ payload: recordCache.payload })
      .from(recordCache)
      .where(
        and(
          eq(recordCache.recordId, recordId),
          eq(recordCache.paramsHash, paramsHash),
          eq(recordCache.versionKey, version)
        )
      );
    if (hit) return hit.payload as RecordResponse;
  }

  const ranked =
    eligible.seasonIds.length === 0
      ? []
      : await ENGINES[def.engine]!({ db, leagueId, def, q, seasonIds: eligible.seasonIds });
  const { rows, entities } = await resolveRows(
    db,
    ranked,
    eligible.years.length === 1 ? { singleYear: eligible.years[0]! } : {}
  );
  const response: RecordResponse = {
    meta: {
      id: def.id,
      title: def.title,
      category: def.category,
      section: def.section,
      grain: def.grain,
      direction: def.direction,
      sortKey: def.sortKey,
      columns: def.columns,
      active: def.active,
      requires: def.requires,
      displayAll: def.displayAll ?? false,
      qualifier: def.qualifier
        ? { minGames: minGames({ db, leagueId, def, q, seasonIds: eligible.seasonIds }) }
        : null,
    },
    params: q,
    rows,
    total: ranked[0]?.total ?? 0,
    entities,
    dataVersion: version,
    availableFrom: eligible.availableFrom,
    seasonsIncluded: eligible.years,
  };

  if (!options.noCache) {
    await db
      .insert(recordCache)
      .values({ recordId, paramsHash, versionKey: version, payload: response })
      .onConflictDoNothing();
  }
  return response;
}
