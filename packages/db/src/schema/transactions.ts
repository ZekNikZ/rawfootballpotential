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
import {
  draftKind,
  draftStatus,
  draftType,
  txDirection,
  txItemKind,
  txStatus,
  txType,
} from "./enums";
import { league, leagueSeason } from "./league";
import { franchise, teamSeason } from "./people";
import { player } from "./players";

export const transaction = pgTable(
  "transaction",
  {
    id: pk(),
    leagueSeasonId: integer()
      .notNull()
      .references(() => leagueSeason.id, { onDelete: "cascade" }),
    /** Sleeper transaction_id; null for sources without one. */
    externalId: text(),
    type: txType().notNull(),
    /** Failed claims are stored but never counted. */
    status: txStatus().notNull(),
    failureReason: text(),
    /** Fantasy week the transaction belongs to (0 = before week 1). Its scope comes from this week. */
    week: integer().notNull(),
    executedAt: ts(),
    waiverPriority: integer(),
    /** The team that initiated it (claimant, trade proposer). */
    creatorTeamSeasonId: integer().references(() => teamSeason.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("transaction_external_uq").on(t.leagueSeasonId, t.externalId),
    index("transaction_season_week_idx").on(t.leagueSeasonId, t.week),
  ]
);

export const transactionItem = pgTable(
  "transaction_item",
  {
    id: pk(),
    transactionId: integer()
      .notNull()
      .references(() => transaction.id, { onDelete: "cascade" }),
    kind: txItemKind().notNull(),
    direction: txDirection().notNull(),
    playerId: integer().references(() => player.id),
    // Draft pick reference (kind = 'pick').
    pickSeason: integer(),
    pickRound: integer(),
    pickOriginalFranchiseId: integer().references(() => franchise.id),
    /** FAAB dollars moved (kind = 'faab'). */
    amount: integer(),
    /** Winning bid on a waiver add. */
    faabBid: integer(),
    fromTeamSeasonId: integer().references(() => teamSeason.id, { onDelete: "set null" }),
    toTeamSeasonId: integer().references(() => teamSeason.id, { onDelete: "set null" }),
  },
  (t) => [
    index("transaction_item_tx_idx").on(t.transactionId),
    index("transaction_item_player_idx").on(t.playerId),
    index("transaction_item_to_idx").on(t.toTeamSeasonId),
    index("transaction_item_from_idx").on(t.fromTeamSeasonId),
  ]
);

export const draft = pgTable(
  "draft",
  {
    id: pk(),
    leagueSeasonId: integer()
      .notNull()
      .references(() => leagueSeason.id, { onDelete: "cascade" }),
    externalId: text(),
    kind: draftKind().notNull(),
    type: draftType().notNull(),
    status: draftStatus().notNull(),
    rounds: integer(),
    startedAt: ts(),
    /** slot -> team_season_id, for draft boards before picks are made. */
    slotOrder: jsonb().$type<Record<string, number>>(),
  },
  (t) => [unique("draft_external_uq").on(t.leagueSeasonId, t.externalId)]
);

export const draftPick = pgTable(
  "draft_pick",
  {
    draftId: integer()
      .notNull()
      .references(() => draft.id, { onDelete: "cascade" }),
    pickNo: integer().notNull(),
    round: integer().notNull(),
    slot: integer(),
    /** Team that made the pick. */
    teamSeasonId: integer()
      .notNull()
      .references(() => teamSeason.id, { onDelete: "cascade" }),
    /** Team that owned the slot before a traded pick, when known. */
    originalTeamSeasonId: integer().references(() => teamSeason.id, { onDelete: "set null" }),
    playerId: integer().references(() => player.id),
    /** Auction price. */
    amount: integer(),
    isKeeper: boolean().notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.draftId, t.pickNo] }),
    index("draft_pick_team_idx").on(t.teamSeasonId),
    index("draft_pick_player_idx").on(t.playerId),
  ]
);

/** Future picks (dynasty): who owns which pick. Rebuilt daily. */
export const tradedPick = pgTable(
  "traded_pick",
  {
    id: pk(),
    leagueId: integer()
      .notNull()
      .references(() => league.id, { onDelete: "cascade" }),
    season: integer().notNull(),
    round: integer().notNull(),
    originalFranchiseId: integer()
      .notNull()
      .references(() => franchise.id),
    ownerFranchiseId: integer()
      .notNull()
      .references(() => franchise.id),
    asOf: ts().notNull().defaultNow(),
  },
  (t) => [unique("traded_pick_uq").on(t.leagueId, t.season, t.round, t.originalFranchiseId)]
);
