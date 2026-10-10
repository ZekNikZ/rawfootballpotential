import { boolean, index, integer, pgTable, primaryKey, text, unique } from "drizzle-orm/pg-core";
import { pk, pts, ts } from "./_helpers";
import { acquiredVia, bracket, gameResultValue, gameType, slotKind } from "./enums";
import { leagueSeason } from "./league";
import { nflGame } from "./nfl";
import { player } from "./players";
import { teamSeason } from "./people";

/** One game between two teams. Median games have no matchup row (they are game_result rows). */
export const matchup = pgTable(
  "matchup",
  {
    id: pk(),
    leagueSeasonId: integer()
      .notNull()
      .references(() => leagueSeason.id, { onDelete: "cascade" }),
    week: integer().notNull(),
    /** Sleeper `matchup_id` within the week (null for bracket games reconstructed without one). */
    externalMatchupId: integer(),
    gameType: gameType().notNull(),
    bracket: bracket(),
    bracketRound: integer(),
    /** Bracket `p`: the final place this game decides (1 = championship, 3 = third place, ...). */
    placementAtStake: integer(),
    isChampionship: boolean().notNull().default(false),
    /**
     * Scoring periods the game spans: 1 normally, 2 for a two-week playoff matchup (ESPN 2020). The combined score
     * counts for results, totals and placements, but is not comparable with a one-week score, so single-game and
     * lineup records skip games with span_weeks > 1.
     */
    spanWeeks: integer().notNull().default(1),
  },
  (t) => [
    unique("matchup_external_uq").on(t.leagueSeasonId, t.week, t.externalMatchupId),
    index("matchup_season_week_idx").on(t.leagueSeasonId, t.week),
  ]
);

/** One team in one week: its score, and its game if it had one. */
export const teamWeek = pgTable(
  "team_week",
  {
    id: pk(),
    leagueSeasonId: integer()
      .notNull()
      .references(() => leagueSeason.id, { onDelete: "cascade" }),
    teamSeasonId: integer()
      .notNull()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    week: integer().notNull(),
    /** null = no game (playoff bye / eliminated / no bracket game). */
    matchupId: integer().references(() => matchup.id, { onDelete: "set null" }),
    opponentTeamSeasonId: integer().references(() => teamSeason.id, { onDelete: "set null" }),
    /** false for no-game weeks and game_type 'none'. */
    counts: boolean().notNull().default(true),
    points: pts().notNull().default(0),
    /** true when an `override` row replaced the ingested score. */
    pointsOverridden: boolean().notNull().default(false),
    result: gameResultValue(),
    margin: pts(),
    /** Live scores update until the week completes. */
    isFinal: boolean().notNull().default(false),
  },
  (t) => [
    unique("team_week_team_week_uq").on(t.teamSeasonId, t.week),
    index("team_week_season_week_idx").on(t.leagueSeasonId, t.week),
    index("team_week_matchup_idx").on(t.matchupId),
  ]
);

/** A rostered player in one team-week, with that week's slot, points and position snapshot. */
export const playerWeek = pgTable(
  "player_week",
  {
    teamWeekId: integer()
      .notNull()
      .references(() => teamWeek.id, { onDelete: "cascade" }),
    playerId: integer()
      .notNull()
      .references(() => player.id),
    /** QB, RB, WR, TE, FLEX, SUPER_FLEX, K, DEF, DL, LB, DB, IDP_FLEX, BN, IR, TAXI, ... */
    slot: text().notNull(),
    /** starter | bench | ir | taxi. (Replaces the doc's `is_starter`; starter = slotKind 'starter'.) */
    slotKind: slotKind().notNull(),
    points: pts(),
    projectedPoints: pts(),
    /** Snapshot for that week, never "today's" position. */
    position: text(),
    eligiblePositions: text().array(),
    nflTeam: text(),
    /** null with a known nfl_team = the player's team was on bye. */
    nflGameId: text().references(() => nflGame.id, { onDelete: "set null" }),
    /** nflverse roster status: active / inactive / reserve ... */
    nflStatus: text(),
  },
  (t) => [
    primaryKey({ columns: [t.teamWeekId, t.playerId] }),
    index("player_week_player_idx").on(t.playerId),
  ]
);

/**
 * What a player scored in a week under a league season's scoring (as played), whether or not anyone rostered him:
 * Sleeper's raw stat lines scored with the league's settings. Only non-zero lines are stored. Rostered players'
 * points match `player_week.points`; this also covers free agents, so a traded player can be valued after he was dropped.
 */
export const playerWeekPoints = pgTable(
  "player_week_points",
  {
    leagueSeasonId: integer()
      .notNull()
      .references(() => leagueSeason.id, { onDelete: "cascade" }),
    week: integer().notNull(),
    playerId: integer()
      .notNull()
      .references(() => player.id, { onDelete: "cascade" }),
    points: pts().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.leagueSeasonId, t.week, t.playerId] }),
    index("player_week_points_player_idx").on(t.playerId),
  ]
);

/** Live roster (Teams/Rosters pages), also in the offseason. */
export const rosterCurrent = pgTable(
  "roster_current",
  {
    teamSeasonId: integer()
      .notNull()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    playerId: integer()
      .notNull()
      .references(() => player.id),
    slot: text(),
    slotKind: slotKind().notNull(),
    acquiredVia: acquiredVia(),
    acquiredAt: ts(),
  },
  (t) => [
    primaryKey({ columns: [t.teamSeasonId, t.playerId] }),
    index("roster_current_player_idx").on(t.playerId),
  ]
);
