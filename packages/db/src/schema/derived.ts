import { boolean, index, integer, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { pk, pts, ts } from "./_helpers";
import {
  acquiredVia,
  gameResultKind,
  gameResultValue,
  gameType,
  leftVia,
  syncKind,
  syncStatus,
  trophyKind,
} from "./enums";
import { leagueSeason } from "./league";
import { teamWeek, matchup } from "./games";
import { franchise, teamSeason } from "./people";
import { player } from "./players";

// Derived layer: separate tables so a recompute can wipe and refill them without touching ingested data.

export const teamWeekStats = pgTable("team_week_stats", {
  teamWeekId: integer()
    .primaryKey()
    .references(() => teamWeek.id, { onDelete: "cascade" }),
  optimalPoints: pts(),
  benchPoints: pts(),
  irPoints: pts(),
  projectedPoints: pts(),
  /** points / optimal_points. */
  lineupIq: pts(),
  /** optimal - actual < 0.01. */
  isPerfect: boolean(),
  /** True median of all teams' scores that week. */
  weekMedian: pts(),
  weekMean: pts(),
  /** 1 = highest score; ties share a rank. */
  weekRank: integer(),
  weekZscore: pts(),
  allplayW: integer(),
  allplayL: integer(),
  allplayT: integer(),
  /** Largest single-player share of the team's starter points. */
  topPlayerShare: pts(),
  /** Starters on an NFL bye or inactive that week (doc 4.5). null without player data. */
  asleepStarters: integer(),
  /** Of those, starters whose NFL team was on bye. */
  byeStarters: integer(),
  /** Points the best eligible live bench players would have added in the dead starters' slots. */
  asleepPointsLost: pts(),
});

/**
 * The key table: one row per game a team played, with the median as a pseudo-opponent row
 * (kind = 'median'). `seq` orders games within a week (1 = h2h, 2 = median).
 */
export const gameResult = pgTable(
  "game_result",
  {
    teamSeasonId: integer()
      .notNull()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    franchiseId: integer()
      .notNull()
      .references(() => franchise.id),
    leagueSeasonId: integer()
      .notNull()
      .references(() => leagueSeason.id, { onDelete: "cascade" }),
    week: integer().notNull(),
    seq: integer().notNull(),
    kind: gameResultKind().notNull(),
    matchupId: integer().references(() => matchup.id, { onDelete: "cascade" }),
    opponentTeamSeasonId: integer().references(() => teamSeason.id, { onDelete: "cascade" }),
    /** Denormalized for head-to-head matrices. */
    opponentFranchiseId: integer().references(() => franchise.id),
    result: gameResultValue().notNull(),
    gameType: gameType().notNull(),
    pointsFor: pts().notNull(),
    /** Opponent's score; for median rows, the week's median. */
    pointsAgainst: pts().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.teamSeasonId, t.week, t.seq] }),
    index("game_result_franchise_idx").on(t.franchiseId, t.leagueSeasonId, t.kind, t.gameType),
    index("game_result_season_idx").on(t.leagueSeasonId, t.week),
    index("game_result_opponent_idx").on(t.franchiseId, t.opponentFranchiseId),
  ]
);

/** Standings after each week (Standings page, history charts, "first place after week N"). */
export const teamSeasonWeek = pgTable(
  "team_season_week",
  {
    teamSeasonId: integer()
      .notNull()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    week: integer().notNull(),
    wins: integer().notNull(),
    losses: integer().notNull(),
    ties: integer().notNull(),
    pf: pts().notNull(),
    pa: pts().notNull(),
    rank: integer().notNull(),
    gamesBack: pts(),
    clinched: text(),
    eliminated: boolean(),
  },
  (t) => [primaryKey({ columns: [t.teamSeasonId, t.week] })]
);

/** Continuous stints of a player on a team within a season. Powers retention, most moved, loyalty. */
export const playerTenure = pgTable(
  "player_tenure",
  {
    id: pk(),
    playerId: integer()
      .notNull()
      .references(() => player.id),
    teamSeasonId: integer()
      .notNull()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    fromWeek: integer().notNull(),
    toWeek: integer().notNull(),
    acquiredVia: acquiredVia().notNull(),
    leftVia: leftVia(),
  },
  (t) => [
    index("player_tenure_team_idx").on(t.teamSeasonId),
    index("player_tenure_player_idx").on(t.playerId),
  ]
);

/** Trophy case + threshold clubs, rebuilt during `finalize`. */
export const trophy = pgTable(
  "trophy",
  {
    id: pk(),
    kind: trophyKind().notNull(),
    teamSeasonId: integer()
      .notNull()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    teamWeekId: integer().references(() => teamWeek.id, { onDelete: "cascade" }),
    value: pts(),
  },
  (t) => [index("trophy_team_season_idx").on(t.teamSeasonId, t.kind)]
);

/** Bumped per season whenever its data changes; keys the response cache. */
export const dataVersion = pgTable("data_version", {
  leagueSeasonId: integer()
    .primaryKey()
    .references(() => leagueSeason.id, { onDelete: "cascade" }),
  version: integer().notNull().default(1),
  /** Version of the derive code that produced this season's derived tables; ingest recomputes on mismatch. */
  deriveVersion: integer().notNull().default(0),
  updatedAt: ts().notNull().defaultNow(),
});

export const syncRun = pgTable(
  "sync_run",
  {
    id: pk(),
    kind: syncKind().notNull(),
    leagueSeasonId: integer().references(() => leagueSeason.id, { onDelete: "set null" }),
    /** 'schedule' or an admin user id. */
    triggeredBy: text().notNull().default("schedule"),
    startedAt: ts().notNull().defaultNow(),
    finishedAt: ts(),
    status: syncStatus().notNull().default("running"),
    log: text(),
    stats: jsonb().$type<Record<string, unknown>>(),
  },
  (t) => [index("sync_run_kind_idx").on(t.kind, t.status, t.startedAt.desc())]
);

/** Cached record responses. version_key = hash of the data_versions of the seasons the query touched. */
export const recordCache = pgTable(
  "record_cache",
  {
    recordId: text().notNull(),
    paramsHash: text().notNull(),
    versionKey: text().notNull(),
    payload: jsonb().notNull(),
    computedAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.recordId, t.paramsHash, t.versionKey] })]
);
