import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
} from "drizzle-orm/pg-core";
import { pk, ts } from "./_helpers";
import { gameType, leagueSource, leagueType, seasonStatus, waiverType, weekStatus } from "./enums";

export const league = pgTable("league", {
  id: pk(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  type: leagueType().notNull(),
  /** Mantine color name, e.g. "blue" / "red"; also picks the logo variant. */
  color: text().notNull().default("blue"),
  displayOrder: integer().notNull().default(0),
  enabled: boolean().notNull().default(true),
});

export const leagueSeason = pgTable(
  "league_season",
  {
    id: pk(),
    leagueId: integer()
      .notNull()
      .references(() => league.id, { onDelete: "cascade" }),
    year: integer().notNull(),
    source: leagueSource().notNull(),
    /** Sleeper league id / ESPN league id. */
    externalId: text().notNull(),
    /** Sleeper `previous_league_id`: seeds the dynasty season -> franchise mapping. */
    previousExternalId: text(),
    status: seasonStatus().notNull().default("pre_draft"),
    enabled: boolean().notNull().default(true),
    regularSeasonWeeks: integer().notNull(),
    playoffWeekStart: integer().notNull(),
    /** Last fantasy week (final playoff week). */
    lastWeek: integer().notNull(),
    playoffTeams: integer().notNull(),
    teamCount: integer().notNull(),
    medianEnabled: boolean().notNull().default(false),
    hasLosersBracket: boolean().notNull().default(false),
    rosterSlots: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    benchSlots: integer().notNull().default(0),
    irSlots: integer().notNull().default(0),
    taxiSlots: integer().notNull().default(0),
    scoringSettings: jsonb().$type<Record<string, number>>().notNull().default({}),
    /** The source's raw league settings (roster positions, trade deadline, ...). */
    settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    waiverType: waiverType().notNull().default("normal"),
    faabBudget: integer(),
    // Data availability: drives `requires` on records. Detected at ingest; admins may override.
    hasPlayerData: boolean().notNull().default(false),
    hasProjections: boolean().notNull().default(false),
    hasTransactions: boolean().notNull().default(false),
    hasDraft: boolean().notNull().default(false),
    hasFaab: boolean().notNull().default(false),
    hasAuctionDraft: boolean().notNull().default(false),
    /** `has_*` columns an admin has set by hand; ingest must not overwrite these. */
    lockedFlags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Denormalized from league_season_week; 0 = nothing complete yet. */
    lastCompletedWeek: integer().notNull().default(0),
  },
  (t) => [
    unique("league_season_league_year_uq").on(t.leagueId, t.year),
    unique("league_season_source_external_uq").on(t.source, t.externalId),
    check(
      "league_season_weeks_ck",
      sql`${t.playoffWeekStart} > ${t.regularSeasonWeeks} AND ${t.lastWeek} >= ${t.playoffWeekStart}`
    ),
  ]
);

export const leagueSeasonWeek = pgTable(
  "league_season_week",
  {
    leagueSeasonId: integer()
      .notNull()
      .references(() => leagueSeason.id, { onDelete: "cascade" }),
    week: integer().notNull(),
    status: weekStatus().notNull().default("upcoming"),
    /** regular before playoff_week_start, playoffs from then on (games are re-typed from the brackets). */
    gameTypeDefault: gameType().notNull(),
    finalizedAt: ts(),
  },
  (t) => [primaryKey({ columns: [t.leagueSeasonId, t.week] })]
);

/** Trophy thresholds (High Scorer's / Benchwarmer's / ...). `league_season_id` null = league default. */
export const leagueThreshold = pgTable(
  "league_threshold",
  {
    id: pk(),
    leagueId: integer()
      .notNull()
      .references(() => league.id, { onDelete: "cascade" }),
    leagueSeasonId: integer().references(() => leagueSeason.id, { onDelete: "cascade" }),
    key: text().notNull(),
    value: numeric({ precision: 10, scale: 3, mode: "number" }).notNull(),
  },
  (t) => [
    unique("league_threshold_uq").on(t.leagueId, t.leagueSeasonId, t.key).nullsNotDistinct(),
    index("league_threshold_league_idx").on(t.leagueId),
  ]
);
