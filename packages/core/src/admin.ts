// Request shapes of the admin API (doc §3.9), shared by the API (validation) and the admin UI (forms).
import { z } from "zod";

export const ADMIN_ROLES = ["owner", "admin"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const MIN_PASSWORD_LENGTH = 12;
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(128);

const reason = z.string().trim().min(3, "A reason is required").max(500);
const id = z.number().int().positive();

// ---- site ----
export const siteInput = z.object({
  name: z.string().trim().min(1).max(80),
  shortName: z.string().trim().min(1).max(20),
});
export const changelogEntry = z.object({
  version: z.string().trim().min(1).max(20),
  date: z.iso.datetime({ offset: true }).or(z.iso.date()),
  title: z.string().trim().min(1).max(120),
  description: z.string().max(10_000),
});
export const changelogInput = z.array(changelogEntry).max(200);
export type ChangelogEntry = z.infer<typeof changelogEntry>;

// ---- leagues and seasons ----
export const leagueCreate = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,30}$/, "Lowercase letters, digits and dashes"),
  name: z.string().trim().min(1).max(60),
  type: z.enum(["redraft", "dynasty"]),
  color: z.enum(["blue", "red", "green", "grape", "orange", "teal"]).default("blue"),
});
export const leaguePatch = z
  .object({
    slug: leagueCreate.shape.slug,
    name: leagueCreate.shape.name,
    color: leagueCreate.shape.color,
    displayOrder: z.number().int().min(0).max(100),
    enabled: z.boolean(),
  })
  .partial();

export const DATA_FLAGS = [
  "hasPlayerData",
  "hasProjections",
  "hasTransactions",
  "hasDraft",
  "hasFaab",
  "hasAuctionDraft",
] as const;
export type DataFlag = (typeof DATA_FLAGS)[number];

export const scoringOverride = z.object({
  stat: z.string().trim().min(1).max(40),
  points: z.number(),
  fromWeek: z.number().int().min(1).max(30).optional(),
  toWeek: z.number().int().min(1).max(30).optional(),
});

export const seasonPatch = z
  .object({
    enabled: z.boolean(),
    /** true / false sets and locks a flag against ingest; null unlocks it (ingest detects it again). */
    flags: z.partialRecord(z.enum(DATA_FLAGS), z.boolean().nullable()),
    scoringOverrides: z.array(scoringOverride).max(20),
  })
  .partial();

export const seasonAdd = z.object({
  leagueId: id,
  source: z.literal("sleeper"),
  externalId: z
    .string()
    .trim()
    .regex(/^\d{6,25}$/, "A Sleeper league id"),
});

// ---- managers and franchises ----
export const managerPatch = z
  .object({
    name: z.string().trim().min(1).max(60),
    avatar: z.string().trim().url().max(300).nullable(),
  })
  .partial();
export const identityInput = z.object({
  source: z.enum(["sleeper", "espn"]),
  externalUserId: z.string().trim().min(1).max(100),
});
export const mergeInput = z
  .object({ fromId: id, intoId: id })
  .refine((v) => v.fromId !== v.intoId, "Pick two different managers");

export const franchisePatch = z.object({ name: z.string().trim().min(1).max(80).nullable() });
export const teamSeasonRemap = z.object({ franchiseId: id });

// ---- corrections ----
export const OVERRIDE_KINDS = ["score", "placement", "game_type", "transaction"] as const;
export const GAME_TYPES = ["regular", "playoffs", "toilet_bowl", "none"] as const;
export const overrideInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("score"),
    teamSeasonId: id,
    week: z.number().int().min(1).max(30),
    points: z.number().min(-100).max(500),
    reason,
  }),
  z.object({
    kind: z.literal("placement"),
    teamSeasonId: id,
    place: z.number().int().min(1).max(40),
    reason,
  }),
  z.object({
    kind: z.literal("game_type"),
    leagueSeasonId: id,
    week: z.number().int().min(1).max(30),
    externalMatchupId: z.number().int().min(0),
    gameType: z.enum(GAME_TYPES),
    reason,
  }),
  // A transaction the commissioner reversed: it is kept but never counted.
  z.object({ kind: z.literal("transaction"), transactionId: id, reason }),
]);
export type OverrideInput = z.infer<typeof overrideInput>;

export const overrideDeactivate = z.object({ reason });

export const thresholdInput = z.object({
  leagueId: id,
  leagueSeasonId: id.nullable(),
  key: z.string().trim().min(1).max(40),
  value: z.number().min(0).max(10_000),
});

// ---- players ----
export const unmatchedMap = z.object({ playerId: id });

// ---- records ----
export const recordConfigInput = z.object({
  leagueId: id.nullable(),
  recordId: z.string().trim().min(1).max(80),
  visible: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
  featured: z.boolean(),
});

// ---- jobs ----
export const JOBS = [
  "live",
  "daily",
  "finalize",
  "nfl-reference",
  "season-rollover",
  "recompute",
] as const;
export type AdminJob = (typeof JOBS)[number];
export const jobInput = z.object({ leagueSeasonId: id.optional() });

// ---- users and invites ----
export const inviteInput = z.object({
  email: z.email().max(200).optional(),
  role: z.enum(ADMIN_ROLES).default("admin"),
});
export const userPatch = z
  .object({
    name: z.string().trim().min(1).max(60),
    role: z.enum(ADMIN_ROLES),
    disabled: z.boolean(),
  })
  .partial();
export const acceptInviteInput = z.object({
  token: z.string().min(20).max(200),
  /** Needed when the invite wasn't issued for a specific email. */
  email: z.email().max(200).optional(),
  name: z.string().trim().min(1).max(60).optional(),
  password: passwordSchema,
});
export const loginInput = z.object({ email: z.email(), password: z.string().min(1).max(128) });

// ---- ESPN bundle (doc §5): gzip'd JSON of every raw response plus a manifest ----
export const espnBundle = z.object({
  manifest: z.object({
    format: z.literal(1),
    /** Which league (slug) and season the responses belong to. */
    league: z.string().min(1),
    year: z.number().int().min(2000).max(2100),
    espnLeagueId: z.string().min(1),
    scrapedAt: z.iso.datetime({ offset: true }),
  }),
  responses: z
    .array(
      z.object({
        endpoint: z.string().min(1).max(300),
        params: z.record(z.string(), z.unknown()).default({}),
        status: z.number().int().default(200),
        payload: z.unknown(),
      })
    )
    .min(1),
});
export type EspnBundle = z.infer<typeof espnBundle>;

// ---- configuration export / import ----
// Everything an admin sets by hand, in a file that does not depend on database ids (leagues are keyed by slug, seasons
// by year, people by their Sleeper / ESPN identities, players by their source ids), so it can be loaded into another
// database. Accounts, sessions, invites, audit history and ingested data are never part of it.
export const CONFIG_BUNDLE_FORMAT = "rfp-config";
export const CONFIG_BUNDLE_VERSION = 1;

const leagueSourceName = z.enum(["sleeper", "espn"]);
const iso = z.iso.datetime({ offset: true });

export const configBundle = z.object({
  format: z.literal(CONFIG_BUNDLE_FORMAT),
  version: z.literal(CONFIG_BUNDLE_VERSION),
  exportedAt: iso,
  /** site_config rows: `site` (name), `changelog` (Version History), ... */
  site: z.array(z.object({ key: z.string().min(1), value: z.unknown() })),
  leagues: z.array(
    z.object({
      slug: z.string().min(1),
      name: z.string().min(1),
      type: z.enum(["redraft", "dynasty"]),
      color: z.string().min(1),
      displayOrder: z.number().int(),
      enabled: z.boolean(),
      seasons: z.array(
        z.object({
          year: z.number().int(),
          source: leagueSourceName,
          /** Sleeper / ESPN league id: lets an import create the season from the source. */
          externalId: z.string().min(1),
          enabled: z.boolean(),
          scoringOverrides: z.array(scoringOverride),
          /** Data flags an admin set by hand (and locked against ingest). */
          lockedFlags: z.partialRecord(z.enum(DATA_FLAGS), z.boolean()),
        })
      ),
      /** `year` null = the league default. */
      thresholds: z.array(
        z.object({ year: z.number().int().nullable(), key: z.string().min(1), value: z.number() })
      ),
      /** Franchise names, and which team seasons (year + the source's roster / team id) belong together. */
      franchises: z.array(
        z.object({
          name: z.string().nullable(),
          teamSeasons: z.array(z.object({ year: z.number().int(), roster: z.string().min(1) })),
        })
      ),
    })
  ),
  /** `league` null = the global setting. */
  recordConfig: z.array(
    z.object({
      league: z.string().nullable(),
      recordId: z.string().min(1),
      visible: z.boolean(),
      sortOrder: z.number().int(),
      featured: z.boolean(),
    })
  ),
  managers: z.array(
    z.object({
      name: z.string().min(1),
      avatar: z.string().nullable(),
      identities: z.array(
        z.object({ source: leagueSourceName, externalUserId: z.string().min(1) })
      ),
    })
  ),
  /** Corrections. `target` replaces the `ls:<id>:` prefix of the stored key with the league and year. */
  overrides: z.array(
    z.object({
      entity: z.string().min(1),
      target: z
        .object({ league: z.string().min(1), year: z.number().int(), rest: z.string() })
        .nullable(),
      /** The stored entity id as is, for a correction that is not tied to a league season. */
      entityId: z.string().nullable(),
      field: z.string().min(1),
      value: z.unknown(),
      reason: z.string(),
      active: z.boolean(),
      createdAt: iso,
    })
  ),
  /** Manual player links and the decisions made in the unmatched-player queue, keyed by the players' source ids. */
  playerLinks: z.array(
    z.object({
      sleeperId: z.string().nullable(),
      espnId: z.string().nullable(),
      gsisId: z.string().nullable(),
      yahooId: z.string().nullable(),
      pfrId: z.string().nullable(),
      name: z.string().nullable(),
      /** The player the ids point at, by a source id (null = linked to no player). */
      player: z
        .object({
          sleeperId: z.string().nullable(),
          espnId: z.string().nullable(),
          gsisId: z.string().nullable(),
        })
        .nullable(),
    })
  ),
  unmatchedPlayers: z.array(
    z.object({
      source: leagueSourceName,
      externalId: z.string().min(1),
      name: z.string().nullable(),
      position: z.string().nullable(),
      nflTeam: z.string().nullable(),
      status: z.enum(["open", "mapped", "ignored"]),
      resolvedPlayer: z
        .object({
          sleeperId: z.string().nullable(),
          espnId: z.string().nullable(),
          gsisId: z.string().nullable(),
        })
        .nullable(),
    })
  ),
});
export type ConfigBundle = z.infer<typeof configBundle>;
