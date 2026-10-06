import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
} from "drizzle-orm/pg-core";
import { pk, ts } from "./_helpers";
import { nflGameStatus, nflGameType } from "./enums";
import { player } from "./players";

/** Sleeper `/state/nfl`: decides the "current week". One row per NFL season. */
export const nflState = pgTable("nfl_state", {
  season: integer().primaryKey(),
  week: integer().notNull(),
  seasonType: text().notNull(),
  displayWeek: integer(),
  leagueSeason: text(),
  /** The full response. */
  raw: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: ts().notNull().defaultNow(),
});

/** nflverse `games.csv`. `id` is nflverse's game_id (e.g. 2023_01_KC_DET). */
export const nflGame = pgTable(
  "nfl_game",
  {
    id: text().primaryKey(),
    season: integer().notNull(),
    week: integer().notNull(),
    gameType: nflGameType().notNull(),
    /** nflverse's own `game_type` (REG, WC, DIV, CON, SB), kept for playoff rounds. */
    sourceGameType: text(),
    kickoff: ts(),
    homeTeam: text().notNull(),
    awayTeam: text().notNull(),
    homeScore: integer(),
    awayScore: integer(),
    status: nflGameStatus().notNull().default("scheduled"),
  },
  (t) => [index("nfl_game_season_week_idx").on(t.season, t.week)]
);

/** Derived: one row per NFL team per week; `nfl_game_id` null = bye. */
export const nflTeamWeek = pgTable(
  "nfl_team_week",
  {
    season: integer().notNull(),
    week: integer().notNull(),
    nflTeam: text().notNull(),
    nflGameId: text().references(() => nflGame.id, { onDelete: "set null" }),
    isBye: boolean().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.season, t.week, t.nflTeam] })]
);

/** nflverse weekly rosters, keyed through the ID crosswalk. */
export const nflPlayerWeek = pgTable(
  "nfl_player_week",
  {
    season: integer().notNull(),
    week: integer().notNull(),
    playerId: integer()
      .notNull()
      .references(() => player.id, { onDelete: "cascade" }),
    nflTeam: text().notNull(),
    /** nflverse roster status: ACT, INA, RES, DEV, ... kept as published. */
    status: text(),
    position: text(),
  },
  (t) => [
    primaryKey({ columns: [t.season, t.week, t.playerId] }),
    index("nfl_player_week_player_idx").on(t.playerId),
  ]
);

/** Maps the abbreviations different sources use (OAK, SD, STL, WSH, ...) onto one canonical code. */
export const nflTeamAlias = pgTable(
  "nfl_team_alias",
  {
    id: pk(),
    alias: text().notNull(),
    nflTeam: text().notNull(),
    /** Optional validity window for abbreviations that were reused. */
    seasonFrom: integer(),
    seasonTo: integer(),
  },
  (t) => [unique("nfl_team_alias_uq").on(t.alias, t.seasonFrom).nullsNotDistinct()]
);
