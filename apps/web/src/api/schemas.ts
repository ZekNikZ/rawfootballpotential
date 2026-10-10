import { z } from "zod";

// Response shapes the web app relies on. The API is ours, but the browser is still a boundary: parsing here turns a
// contract drift into one readable error instead of `undefined is not a function` somewhere in a table.

const nullableNum = z.number().nullable();

export const seasonSchema = z.object({
  id: z.number(),
  year: z.number(),
  source: z.string(),
  status: z.string(),
  regularSeasonWeeks: z.number(),
  playoffWeekStart: nullableNum,
  lastWeek: z.number(),
  playoffTeams: z.number(),
  teamCount: z.number(),
  medianEnabled: z.boolean(),
  hasLosersBracket: z.boolean(),
  lastCompletedWeek: nullableNum,
  data: z.object({
    playerData: z.boolean(),
    projections: z.boolean(),
    transactions: z.boolean(),
    draft: z.boolean(),
    faab: z.boolean(),
    auctionDraft: z.boolean(),
  }),
});
export type Season = z.infer<typeof seasonSchema>;

export const leagueSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  type: z.enum(["redraft", "dynasty"]),
  color: z.string(),
  seasons: z.array(seasonSchema),
});
export type League = z.infer<typeof leagueSchema>;
export const leaguesResponse = z.object({ leagues: z.array(leagueSchema) });

export const siteResponse = z.object({
  site: z.object({ name: z.string(), shortName: z.string() }).nullable(),
  changelog: z.array(
    z.object({
      date: z.string(),
      title: z.string(),
      version: z.string(),
      description: z.string(),
    })
  ),
});
export type SiteResponse = z.infer<typeof siteResponse>;

// ---- records ----

export const COLUMN_TYPES = [
  "team",
  "opponent",
  "manager",
  "season",
  "week",
  "player",
  "int",
  "decimal",
  "points",
  "pct",
  "currency",
  "text",
  "seasons",
  "teams",
  "scoreline",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const columnSchema = z.object({
  key: z.string(),
  title: z.string(),
  type: z.enum(COLUMN_TYPES),
  hint: z.string().optional(),
  ranked: z.boolean().optional(),
});
export type Column = z.infer<typeof columnSchema>;

export const FILTER_KEYS = [
  "seasons",
  "scope",
  "median",
  "weeks",
  "franchise",
  "opponent",
  "onePer",
  "positions",
  "slots",
  "excludeZero",
  "countedOnly",
  "minGames",
  "combineTeams",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export const catalogRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  description: z.string().optional(),
  category: z.enum(["overall", "single-season", "manager"]),
  section: z.string(),
  grain: z.string(),
  sortKey: z.string(),
  direction: z.enum(["asc", "desc"]),
  columns: z.array(columnSchema),
  filters: z.array(z.enum(FILTER_KEYS)),
  preset: z.record(z.string(), z.unknown()).optional(),
  positionOptions: z.array(z.string()).optional(),
  displayAll: z.boolean().optional(),
  qualifier: z.object({ minGames: z.number() }).optional(),
  availableFrom: nullableNum,
});
export type CatalogRecord = z.infer<typeof catalogRecordSchema>;
export const catalogResponse = z.object({ records: z.array(catalogRecordSchema) });

const entitiesSchema = z.object({
  franchises: z.record(
    z.string(),
    z.object({
      teamName: z.string().nullable(),
      managerId: nullableNum,
      season: nullableNum,
    })
  ),
  teamSeasons: z.record(
    z.string(),
    z.object({
      name: z.string(),
      season: z.number(),
      franchiseId: z.number(),
      managerId: nullableNum,
    })
  ),
  managers: z.record(z.string(), z.object({ name: z.string(), avatar: z.string().nullable() })),
});
export type Entities = z.infer<typeof entitiesSchema>;

const refsSchema = z.record(z.string(), z.unknown());

export const recordResponse = z.object({
  meta: z.object({
    id: z.string(),
    title: z.string(),
    grain: z.string(),
    direction: z.enum(["asc", "desc"]),
    sortKey: z.string(),
    columns: z.array(columnSchema),
    displayAll: z.boolean(),
    qualifier: z.object({ minGames: z.number() }).nullable(),
  }),
  params: z.object({
    seasons: z.union([
      z.literal("all"),
      z.array(z.number()),
      z.object({ from: z.number(), to: z.number() }),
    ]),
    scope: z.string(),
    median: z.string(),
    weeks: z.object({ from: z.number(), to: z.number() }).optional(),
    franchise: z.number().optional(),
    opponent: z.number().optional(),
    onePer: z.string().optional(),
    positions: z.array(z.string()).optional(),
    slots: z.array(z.string()).optional(),
    excludeZero: z.boolean(),
    countedOnly: z.boolean(),
    combineTeams: z.boolean(),
    minGames: z.number().optional(),
    sort: z.string().optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    limit: z.number(),
    offset: z.number(),
  }),
  rows: z.array(
    z.object({
      rank: z.number(),
      values: z.record(z.string(), z.unknown()),
      refs: refsSchema,
      inProgress: z.boolean(),
    })
  ),
  total: z.number(),
  entities: entitiesSchema,
  availableFrom: nullableNum,
  seasonsIncluded: z.array(z.number()),
});
export type RecordResponse = z.infer<typeof recordResponse>;
export type RecordRow = RecordResponse["rows"][number];

// ---- head to head, trophies, franchises ----

const resultCell = z.object({ w: z.number(), l: z.number(), t: z.number(), games: z.number() });
export const h2hResponse = z.object({
  franchises: z.array(z.number()),
  matrix: z.record(z.string(), z.record(z.string(), resultCell)),
  entities: entitiesSchema,
  seasonsIncluded: z.array(z.number()),
  availableFrom: nullableNum,
});
export type HeadToHead = z.infer<typeof h2hResponse>;

export const TROPHY_TYPES = [
  "placement",
  "high-scorer-club",
  "benchwarmer-club",
  "smartypants-club",
  "season-high-score",
  "season-narrowest-win",
  "season-largest-blowout",
  "season-points-for",
  "season-points-against",
  "season-high-iq",
] as const;
export type TrophyType = (typeof TROPHY_TYPES)[number];

export const trophySchema = z.object({
  type: z.enum(TROPHY_TYPES),
  season: z.number(),
  franchiseId: z.number(),
  teamSeasonId: z.number(),
  week: nullableNum,
  value: z.number(),
  opponentTeamSeasonId: nullableNum,
  opponentPoints: nullableNum,
  managerId: nullableNum,
  opponentManagerId: nullableNum,
});
export type Trophy = z.infer<typeof trophySchema>;

export const trophiesResponse = z.object({
  trophies: z.array(trophySchema),
  entities: entitiesSchema,
  availableFrom: nullableNum,
  seasonsIncluded: z.array(z.number()),
});
export type TrophiesResponse = z.infer<typeof trophiesResponse>;

export const placementsResponse = z.object({
  points: z.array(
    z.object({
      franchiseId: z.number(),
      season: z.number(),
      place: z.number(),
      teamCount: z.number(),
    })
  ),
  franchises: z.array(z.number()),
  entities: entitiesSchema,
  seasonsIncluded: z.array(z.number()),
});
export type PlacementHistory = z.infer<typeof placementsResponse>;

export const franchisesResponse = z.object({
  franchises: z.array(z.number()),
  entities: entitiesSchema,
});

export const franchiseProfileResponse = z.object({
  franchiseId: z.number(),
  seasons: z.array(
    z.object({
      season: z.number(),
      status: z.string(),
      avatar: z.string().nullable(),
      teamSeasonId: z.number(),
      teamName: z.string(),
      division: z.string().nullable(),
      seed: nullableNum,
      finalPlace: nullableNum,
      madePlayoffs: z.boolean().nullable(),
      teamCount: z.number(),
      record: z.object({ wins: z.number(), losses: z.number(), ties: z.number() }),
      pf: z.number(),
      pa: z.number(),
      managerId: nullableNum,
    })
  ),
  records: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      section: z.string(),
      rank: z.number(),
      of: z.number(),
      values: z.record(z.string(), z.unknown()),
    })
  ),
  trophies: z.array(trophySchema),
  entities: entitiesSchema,
});
export type FranchiseProfile = z.infer<typeof franchiseProfileResponse>;

export const franchiseRosterResponse = z.object({
  franchiseId: z.number(),
  season: z.number(),
  /** live = current roster; final-week = lineup of the last week played; none = nothing on file. */
  source: z.enum(["live", "final-week", "none"]),
  week: nullableNum,
  irUnrecorded: z.number(),
  players: z.array(
    z.object({
      playerId: z.number(),
      name: z.string(),
      position: z.string().nullable(),
      nflTeam: z.string().nullable(),
      injuryStatus: z.string().nullable(),
      slot: z.string().nullable(),
      slotKind: z.string(),
      points: z.number().nullable(),
      weeks: z.number(),
      starts: z.number(),
    })
  ),
});
export type FranchiseRoster = z.infer<typeof franchiseRosterResponse>;

// ---- blog ----

export const blogResponse = z.object({
  posts: z.array(
    z.object({
      title: z.string(),
      link: z.string(),
      date: z.string(),
      author: z.string(),
      previewText: z.string(),
      imgSrc: z.string().nullable(),
    })
  ),
});
export type BlogPost = z.infer<typeof blogResponse>["posts"][number];

// ---- season pages ----

const seasonSummary = z.object({
  id: z.number(),
  year: z.number(),
  status: z.string(),
  regular_season_weeks: z.number(),
  playoff_week_start: z.number(),
  last_week: z.number(),
  playoff_teams: z.number(),
  team_count: z.number(),
  median_enabled: z.boolean(),
  has_losers_bracket: z.boolean(),
  last_completed_week: z.number(),
});

export const standingsResponse = z.object({
  season: seasonSummary,
  week: nullableNum,
  weeks: z.array(z.number()),
  rows: z.array(
    z.object({
      team_season_id: z.number(),
      franchise_id: z.number(),
      division: z.string().nullable(),
      wins: z.number(),
      losses: z.number(),
      ties: z.number(),
      pf: z.number(),
      pa: z.number(),
      rank: z.number(),
      games_back: nullableNum,
      clinched: z.string().nullable(),
      eliminated: z.boolean().nullable(),
      seed: nullableNum,
      final_place: nullableNum,
      made_playoffs: z.boolean().nullable(),
      avatar: z.string().nullable(),
    })
  ),
  entities: entitiesSchema,
});
export type Standings = z.infer<typeof standingsResponse>;

export const lineupEntry = z.object({
  playerId: z.number(),
  name: z.string(),
  position: z.string().nullable(),
  nflTeam: z.string().nullable(),
  slot: z.string(),
  slotKind: z.string(),
  points: nullableNum,
  projected: nullableNum,
  nflStatus: z.string().nullable(),
  onBye: z.boolean(),
});
export type LineupEntry = z.infer<typeof lineupEntry>;

const matchupTeam = z.object({
  teamSeasonId: z.number(),
  points: z.number(),
  projected: nullableNum,
  result: z.string().nullable(),
  isFinal: z.boolean(),
  pointsOverridden: z.boolean(),
  avatar: z.string().nullable(),
  /** Players certainly on IR that the data lists as bench (older weeks). */
  irUnrecorded: z.number(),
  lineup: z.array(lineupEntry).optional(),
});
export type MatchupTeam = z.infer<typeof matchupTeam>;

export const matchupsResponse = z.object({
  season: seasonSummary,
  week: z.number(),
  weekStatus: z.string(),
  games: z.array(
    z.object({
      matchupId: z.number(),
      gameType: z.string().nullable(),
      bracket: z.string().nullable(),
      bracketRound: nullableNum,
      placementAtStake: nullableNum,
      isChampionship: z.boolean(),
      spanWeeks: z.number().int().default(1),
      counts: z.boolean(),
      teams: z.array(matchupTeam),
    })
  ),
  idle: z.array(matchupTeam),
  entities: entitiesSchema,
});
export type Matchups = z.infer<typeof matchupsResponse>;

export const teamsResponse = z.object({
  season: seasonSummary,
  teams: z.array(
    z.object({
      team_season_id: z.number(),
      franchise_id: z.number(),
      name: z.string(),
      avatar: z.string().nullable(),
      division: z.string().nullable(),
      seed: nullableNum,
      final_place: nullableNum,
      made_playoffs: z.boolean().nullable(),
      wins: nullableNum,
      losses: nullableNum,
      ties: nullableNum,
      pf: nullableNum,
      pa: nullableNum,
      rank: nullableNum,
      roster: z
        .array(
          z.object({
            playerId: z.number(),
            name: z.string(),
            position: z.string().nullable(),
            nflTeam: z.string().nullable(),
            injuryStatus: z.string().nullable(),
            status: z.string().nullable(),
            slot: z.string().nullable(),
            slotKind: z.string(),
            acquiredVia: z.string().nullable(),
          })
        )
        .optional(),
    })
  ),
  entities: entitiesSchema,
});
export type Teams = z.infer<typeof teamsResponse>;

export const transactionsResponse = z.object({
  total: z.number(),
  transactions: z.array(
    z.object({
      id: z.number(),
      type: z.string(),
      status: z.string(),
      failureReason: z.string().nullable(),
      week: nullableNum,
      executedAt: z.string().nullable(),
      creatorTeamSeasonId: nullableNum,
      tradeValue: z
        .array(
          z.object({
            teamSeasonId: z.number(),
            gained: z.number(),
            lost: z.number(),
            net: z.number(),
          })
        )
        .nullable(),
      items: z.array(
        z.object({
          kind: z.string(),
          direction: z.string().nullable(),
          player: z.string().nullable(),
          position: z.string().nullable(),
          pickSeason: nullableNum,
          pickRound: nullableNum,
          originalFranchiseId: nullableNum,
          amount: nullableNum,
          faabBid: nullableNum,
          fromTeamSeasonId: nullableNum,
          toTeamSeasonId: nullableNum,
          estimatedValue: nullableNum,
        })
      ),
    })
  ),
  entities: entitiesSchema,
});
export type Transactions = z.infer<typeof transactionsResponse>;

export const picksResponse = z.object({
  picks: z.array(
    z.object({
      season: z.number(),
      round: z.number(),
      originalFranchiseId: z.number(),
      ownerFranchiseId: z.number(),
      asOf: z.string().nullable(),
    })
  ),
  entities: entitiesSchema,
});

export const draftsResponse = z.object({
  drafts: z.array(
    z.object({
      id: z.number(),
      kind: z.string(),
      type: z.string(),
      status: z.string(),
      rounds: nullableNum,
      startedAt: z.string().nullable(),
      slotOrder: z.record(z.string(), z.number()).nullable(),
      picks: z.array(
        z.object({
          pickNo: z.number(),
          round: z.number(),
          slot: nullableNum,
          teamSeasonId: z.number(),
          originalTeamSeasonId: nullableNum,
          playerId: nullableNum,
          player: z.string().nullable(),
          position: z.string().nullable(),
          nflTeam: z.string().nullable(),
          byeWeek: nullableNum,
          amount: nullableNum,
          isKeeper: z.boolean(),
        })
      ),
    })
  ),
  entities: entitiesSchema,
});
export type Drafts = z.infer<typeof draftsResponse>;

// ---- home page panels ----

export const superlativesResponse = z.object({
  week: nullableNum,
  items: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      unit: z.enum(["points", "margin", "pct"]),
      holders: z.array(
        z.object({
          teamSeasonId: z.number(),
          avatar: z.string().nullable(),
          opponentTeamSeasonId: nullableNum,
          value: z.number(),
        })
      ),
    })
  ),
  entities: entitiesSchema,
});
export type Superlatives = z.infer<typeof superlativesResponse>;

export const topPerformersResponse = z.object({
  week: nullableNum,
  players: z.array(
    z.object({
      playerId: z.number(),
      name: z.string(),
      position: z.string().nullable(),
      nflTeam: z.string().nullable(),
      points: z.number(),
      slotKind: z.string(),
      teamSeasonId: z.number(),
    })
  ),
  entities: entitiesSchema,
});
export type TopPerformers = z.infer<typeof topPerformersResponse>;
