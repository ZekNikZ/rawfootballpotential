import type { Db, SQL } from "@rfp/db";
import { sql } from "@rfp/db";
import type { MedianMode, RecordDef, RecordQuery, Scope } from "@rfp/core";

export interface RunContext {
  db: Db;
  leagueId: number;
  def: RecordDef;
  /** Normalized query with the record's presets applied. */
  q: RecordQuery;
  /** league_season ids the record reads: the seasons filter, data requirements and active policy all applied. */
  seasonIds: number[];
}

/** What every engine's query must produce per candidate row (see rank.ts). */
export interface Refs {
  franchiseId?: number;
  teamSeasonId?: number;
  teamSeasonIds?: number[];
  opponentTeamSeasonId?: number | null;
  opponentFranchiseId?: number | null;
  matchupId?: number | null;
  leagueSeasonId?: number;
  playerId?: number;
  season?: number;
  week?: number;
}

export interface RankedRow {
  rank: number;
  total: number;
  value: number;
  data: Record<string, unknown>;
  refs: Refs;
  inProgress: boolean;
}

export const inList = (ids: readonly number[]): SQL =>
  sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `
  );

/** `col IN (ids)`. */
export const seasonCond = (col: SQL, ids: readonly number[]): SQL =>
  sql`${col} in (${inList(ids)})`;

/** Scope filter on a game_type column (regular / playoffs / toilet_bowl rows; 'none' never reaches a record). */
export function scopeCond(gameType: SQL, scope: Scope): SQL {
  switch (scope) {
    case "all":
      return sql`true`;
    case "regular":
      return sql`${gameType} = 'regular'`;
    case "playoffs":
      return sql`${gameType} = 'playoffs'`;
    case "toilet_bowl":
      return sql`${gameType} = 'toilet_bowl'`;
    case "postseason":
      return sql`${gameType} in ('playoffs', 'toilet_bowl')`;
  }
}

/** The median filter as SQL over game_result rows (doc §3.2). */
export function medianCond(kind: SQL, medianEnabled: SQL, mode: MedianMode): SQL {
  switch (mode) {
    case "include":
      return sql`true`;
    case "exclude":
      return sql`${kind} = 'h2h'`;
    case "only":
      return sql`${kind} = 'median'`;
    case "default":
      return sql`(${kind} = 'h2h' or ${medianEnabled})`;
  }
}

export function weeksCond(week: SQL, weeks: RecordQuery["weeks"]): SQL {
  return weeks ? sql`${week} between ${weeks.from} and ${weeks.to}` : sql`true`;
}

export const optional = (cond: SQL | undefined): SQL => cond ?? sql`true`;
