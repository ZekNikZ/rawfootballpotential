import { boolean, index, integer, pgTable, primaryKey, text, unique } from "drizzle-orm/pg-core";
import { pk } from "./_helpers";
import { leagueSource, managerRole } from "./enums";
import { league, leagueSeason } from "./league";

export const manager = pgTable("manager", {
  id: pk(),
  name: text().notNull(),
  avatar: text(),
});

/** Sleeper user ids and ESPN SWIDs that belong to a manager. */
export const managerIdentity = pgTable(
  "manager_identity",
  {
    id: pk(),
    managerId: integer()
      .notNull()
      .references(() => manager.id, { onDelete: "cascade" }),
    source: leagueSource().notNull(),
    externalUserId: text().notNull(),
  },
  (t) => [
    unique("manager_identity_uq").on(t.source, t.externalUserId),
    index("manager_identity_manager_idx").on(t.managerId),
  ]
);

/** The unit records follow. Redraft: one per manager. Dynasty: explicit season mapping. */
export const franchise = pgTable(
  "franchise",
  {
    id: pk(),
    leagueId: integer()
      .notNull()
      .references(() => league.id, { onDelete: "cascade" }),
    name: text(),
  },
  (t) => [index("franchise_league_idx").on(t.leagueId)]
);

export const teamSeason = pgTable(
  "team_season",
  {
    id: pk(),
    leagueSeasonId: integer()
      .notNull()
      .references(() => leagueSeason.id, { onDelete: "cascade" }),
    franchiseId: integer()
      .notNull()
      .references(() => franchise.id),
    /** Sleeper roster_id / ESPN team id. */
    externalRosterId: text().notNull(),
    name: text().notNull(),
    avatar: text(),
    division: text(),
    seed: integer(),
    finalPlace: integer(),
    madePlayoffs: boolean(),
  },
  (t) => [
    unique("team_season_franchise_uq").on(t.leagueSeasonId, t.franchiseId),
    unique("team_season_roster_uq").on(t.leagueSeasonId, t.externalRosterId),
    index("team_season_franchise_idx").on(t.franchiseId),
  ]
);

export const teamSeasonManager = pgTable(
  "team_season_manager",
  {
    teamSeasonId: integer()
      .notNull()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    managerId: integer()
      .notNull()
      .references(() => manager.id),
    role: managerRole().notNull().default("primary"),
    fromWeek: integer(),
    toWeek: integer(),
  },
  (t) => [
    primaryKey({ columns: [t.teamSeasonId, t.managerId] }),
    index("team_season_manager_manager_idx").on(t.managerId),
  ]
);
