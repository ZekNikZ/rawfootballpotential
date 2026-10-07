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
export const OVERRIDE_KINDS = ["score", "placement", "game_type"] as const;
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
