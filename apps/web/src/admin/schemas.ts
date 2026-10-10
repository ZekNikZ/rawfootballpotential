import { z } from "zod";

// Response shapes of /api/admin/*, as far as the admin UI reads them.

const ts = z.string().nullable();

export const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(["owner", "admin"]),
});
export type Me = z.infer<typeof meSchema>;

export const okSchema = z.object({}).loose();

export const siteSchema = z.object({
  site: z.object({ name: z.string(), shortName: z.string() }),
  changelog: z.array(
    z.object({ version: z.string(), date: z.string(), title: z.string(), description: z.string() })
  ),
});

const flagMap = z.record(z.string(), z.boolean());
export const adminLeaguesSchema = z.object({
  leagues: z.array(
    z.object({
      id: z.number(),
      slug: z.string(),
      name: z.string(),
      type: z.string(),
      color: z.string(),
      displayOrder: z.number(),
      enabled: z.boolean(),
      seasons: z.array(
        z.object({
          id: z.number(),
          year: z.number(),
          source: z.string(),
          externalId: z.string(),
          status: z.string(),
          enabled: z.boolean(),
          teamCount: z.number(),
          flags: flagMap,
          lockedFlags: z.array(z.string()),
          scoringOverrides: z.array(
            z.object({
              stat: z.string(),
              points: z.number(),
              fromWeek: z.number().optional(),
              toWeek: z.number().optional(),
            })
          ),
        })
      ),
    })
  ),
});
export type AdminLeague = z.infer<typeof adminLeaguesSchema>["leagues"][number];

export const managersSchema = z.object({
  managers: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      avatar: ts,
      seasons: z.number(),
      identities: z.array(
        z.object({ id: z.number(), source: z.string(), externalUserId: z.string() })
      ),
    })
  ),
});

export const franchisesSchema = z.object({
  franchises: z.array(
    z.object({
      id: z.number(),
      name: ts,
      teamSeasons: z.array(
        z.object({
          id: z.number(),
          year: z.number(),
          leagueSeasonId: z.number(),
          name: z.string(),
          externalRosterId: z.string(),
          managers: z.array(z.string()),
        })
      ),
    })
  ),
});

export const overridesSchema = z.object({
  overrides: z.array(
    z.object({
      id: z.number(),
      entity: z.string(),
      field: z.string(),
      value: z.unknown(),
      reason: z.string(),
      active: z.boolean(),
      createdAt: z.string(),
      year: z.number().nullable(),
      week: z.number().nullable(),
      externalMatchupId: z.number().nullable(),
      externalTransactionId: z.string().nullable(),
      team: ts,
    })
  ),
});

export const transactionsListSchema = z.object({
  transactions: z.array(
    z.object({
      id: z.number(),
      week: z.number(),
      status: z.string(),
      executedAt: ts,
      summary: z.string(),
    })
  ),
});

export const matchupsSchema = z.object({
  games: z.array(
    z.object({
      externalMatchupId: z.number(),
      gameType: z.string(),
      bracket: ts,
      teams: z.array(z.object({ team: z.string(), points: z.number() })),
    })
  ),
});

export const thresholdsSchema = z.object({
  thresholds: z.array(
    z.object({
      id: z.number(),
      leagueId: z.number(),
      leagueSeasonId: z.number().nullable(),
      key: z.string(),
      value: z.number(),
    })
  ),
});

export const unmatchedSchema = z.object({
  unmatched: z.array(
    z.object({
      id: z.number(),
      source: z.string(),
      externalId: z.string(),
      name: ts,
      position: ts,
      nflTeam: ts,
      status: z.string(),
      firstSeenAt: z.string(),
    })
  ),
});
export const playerSearchSchema = z.object({
  players: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      position: ts,
      nflTeam: ts,
    })
  ),
});

export const recordsAdminSchema = z.object({
  leagues: z.array(z.object({ id: z.number(), name: z.string() })),
  records: z.array(
    z.object({ id: z.string(), title: z.string(), section: z.string(), category: z.string() })
  ),
  config: z.array(
    z.object({
      id: z.number(),
      leagueId: z.number().nullable(),
      recordId: z.string(),
      visible: z.boolean(),
      sortOrder: z.number(),
      featured: z.boolean(),
    })
  ),
});

export const runsSchema = z.object({
  runs: z.array(
    z.object({
      id: z.number(),
      kind: z.string(),
      leagueSeasonId: z.number().nullable(),
      year: z.number().nullable(),
      league: ts,
      triggeredBy: z.string(),
      startedAt: z.string(),
      finishedAt: ts,
      status: z.string(),
      stats: z.record(z.string(), z.unknown()).nullable(),
      log: ts,
    })
  ),
});

export const usersSchema = z.object({
  users: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      role: z.enum(["owner", "admin"]),
      disabled: z.boolean(),
      lastLoginAt: ts,
      createdAt: z.string(),
    })
  ),
});
export const invitesSchema = z.object({
  invites: z.array(
    z.object({
      id: z.number(),
      email: ts,
      role: z.string(),
      purpose: z.string(),
      expiresAt: z.string(),
    })
  ),
});
export const linkSchema = z.object({ link: z.string(), expiresAt: z.string() }).loose();

export const auditSchema = z.object({
  entries: z.array(
    z.object({
      id: z.number(),
      at: z.string(),
      action: z.string(),
      entity: z.string(),
      entityId: ts,
      before: z.unknown(),
      after: z.unknown(),
      user: ts,
    })
  ),
});

export const importSchema = z.object({
  bundle: z.string(),
  responses: z.number(),
  endpoints: z.number(),
  note: z.string(),
});

export const inviteInfoSchema = z.object({
  purpose: z.enum(["invite", "reset"]),
  role: z.string(),
  email: ts,
});
