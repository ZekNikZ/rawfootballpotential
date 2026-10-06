import { boolean, index, integer, jsonb, pgTable, text, unique } from "drizzle-orm/pg-core";
import { pk, ts } from "./_helpers";
import { adminRole, leagueSource, unmatchedStatus } from "./enums";
import { league } from "./league";
import { player } from "./players";

// ---- Auth (better-auth, Drizzle adapter). Shapes follow better-auth's core + admin-plugin schema;
// ---- M6 reconciles them against the installed version with a follow-up migration if needed.

export const adminUser = pgTable("admin_user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  /** owner | admin. (admin plugin) */
  role: adminRole().notNull().default("admin"),
  /** Doc's `disabled`: better-auth's admin plugin calls it `banned`. */
  banned: boolean().notNull().default(false),
  banReason: text(),
  banExpires: ts(),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
  lastLoginAt: ts(),
});

export const adminSession = pgTable(
  "admin_session",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => adminUser.id, { onDelete: "cascade" }),
    token: text().notNull().unique(),
    expiresAt: ts().notNull(),
    ipAddress: text(),
    userAgent: text(),
    impersonatedBy: text(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index("admin_session_user_idx").on(t.userId)]
);

export const adminAccount = pgTable(
  "admin_account",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => adminUser.id, { onDelete: "cascade" }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: ts(),
    refreshTokenExpiresAt: ts(),
    scope: text(),
    /** Password hash (providerId = 'credential'). */
    password: text(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index("admin_account_user_idx").on(t.userId)]
);

export const adminVerification = pgTable("admin_verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: ts().notNull(),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
});

/** One-time invite links (no email service): only the hash is stored. */
export const adminInvite = pgTable("admin_invite", {
  id: pk(),
  tokenHash: text().notNull().unique(),
  email: text(),
  role: adminRole().notNull().default("admin"),
  createdBy: text().references(() => adminUser.id, { onDelete: "set null" }),
  expiresAt: ts().notNull(),
  usedAt: ts(),
  createdAt: ts().notNull().defaultNow(),
});

// ---- Config ----

/** Site name / short name, changelog + announcements, ... */
export const siteConfig = pgTable("site_config", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: ts().notNull().defaultNow(),
});

/** Show/hide, order and feature records, globally (league_id null) or per league. */
export const recordConfig = pgTable(
  "record_config",
  {
    id: pk(),
    leagueId: integer().references(() => league.id, { onDelete: "cascade" }),
    recordId: text().notNull(),
    visible: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    featured: boolean().notNull().default(false),
  },
  (t) => [unique("record_config_uq").on(t.leagueId, t.recordId).nullsNotDistinct()]
);

/**
 * Manual corrections. Ingested rows are never edited: normalize applies active overrides,
 * so re-pulling a season never wipes a correction.
 */
export const override = pgTable(
  "override",
  {
    id: pk(),
    /** team_week | matchup | team_season | player_map | league_season | ... */
    entity: text().notNull(),
    entityId: text().notNull(),
    field: text().notNull(),
    value: jsonb().notNull(),
    reason: text().notNull(),
    createdBy: text().references(() => adminUser.id, { onDelete: "set null" }),
    createdAt: ts().notNull().defaultNow(),
    active: boolean().notNull().default(true),
  },
  (t) => [index("override_entity_idx").on(t.entity, t.entityId, t.active)]
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: pk(),
    userId: text().references(() => adminUser.id, { onDelete: "set null" }),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text(),
    before: jsonb(),
    after: jsonb(),
    at: ts().notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_at_idx").on(t.at.desc()),
    index("audit_log_entity_idx").on(t.entity, t.entityId),
  ]
);

/** ESPN / nflverse player ids with no match: the admin mapping queue. */
export const unmatchedPlayer = pgTable(
  "unmatched_player",
  {
    id: pk(),
    source: leagueSource().notNull(),
    externalId: text().notNull(),
    name: text(),
    position: text(),
    nflTeam: text(),
    /** Where it was seen (league season, week, ...). */
    context: jsonb().$type<Record<string, unknown>>(),
    status: unmatchedStatus().notNull().default("open"),
    resolvedPlayerId: integer().references(() => player.id, { onDelete: "set null" }),
    firstSeenAt: ts().notNull().defaultNow(),
  },
  (t) => [unique("unmatched_player_uq").on(t.source, t.externalId)]
);
