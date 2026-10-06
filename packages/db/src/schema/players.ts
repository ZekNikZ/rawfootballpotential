import { boolean, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { pk, ts } from "./_helpers";

/** Current player info (Sleeper's player dump). Per-week position/team live on player_week. */
export const player = pgTable(
  "player",
  {
    id: pk(),
    sleeperId: text().unique(),
    espnId: text(),
    gsisId: text(),
    fullName: text().notNull(),
    position: text(),
    fantasyPositions: text().array(),
    nflTeam: text(),
    injuryStatus: text(),
    status: text(),
    active: boolean(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index("player_espn_idx").on(t.espnId), index("player_gsis_idx").on(t.gsisId)]
);

/** dynastyprocess crosswalk plus manual fixes. A row can exist before its player does. */
export const playerIdMap = pgTable(
  "player_id_map",
  {
    id: pk(),
    playerId: integer().references(() => player.id, { onDelete: "set null" }),
    sleeperId: text(),
    espnId: text(),
    gsisId: text(),
    yahooId: text(),
    pfrId: text(),
    name: text(),
    /** true when an admin created or corrected the row; the crosswalk refresh never overwrites it. */
    manual: boolean().notNull().default(false),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index("player_id_map_sleeper_idx").on(t.sleeperId),
    index("player_id_map_espn_idx").on(t.espnId),
    index("player_id_map_gsis_idx").on(t.gsisId),
    index("player_id_map_player_idx").on(t.playerId),
  ]
);
