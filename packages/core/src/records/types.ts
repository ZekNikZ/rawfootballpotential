// The record model shared by the API (which compiles it to SQL) and the web app (which builds its controls
// from it). Pure data: no SQL here.

export const GRAINS = [
  "team_week",
  "team_season",
  "franchise_career",
  "player_week",
  "player_season",
  "transaction",
  "draft_pick",
] as const;
export type Grain = (typeof GRAINS)[number];

export const SCOPES = ["all", "regular", "postseason", "playoffs", "toilet_bowl"] as const;
export type Scope = (typeof SCOPES)[number];

export const MEDIAN_MODES = ["default", "include", "exclude", "only"] as const;

export const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"] as const;
export const SLOT_FILTERS = ["starter", "bench", "ir", "taxi"] as const;
export type SlotFilter = (typeof SLOT_FILTERS)[number];

/** Filters a record may support; the catalog tells the UI which controls to show. */
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

/** Data a record needs beyond matchup scores; checked against each season's `has_*` flags. */
export type Requirement =
  "playerData" | "projections" | "transactions" | "draft" | "faab" | "auctionDraft";

/**
 * What to do with a partial (in-progress) season (doc §3.3):
 * include = fine as is; complete_only = leave it out until it finishes; flag = include but mark the row.
 */
export type ActivePolicy = "include" | "complete_only" | "flag";

export type ColumnType =
  | "team" // team name + manager, from the row's refs
  | "opponent" // the opposing team, from refs
  | "manager"
  | "season"
  | "week" // "2024 WK 5"
  | "player"
  | "int"
  | "decimal"
  | "points"
  | "pct"
  | "currency"
  | "text"
  | "seasons" // list of seasons
  | "teams" // several teams (a trade), from refs.teamSeasonIds
  | "scoreline"; // "120.50 - 98.10 (Δ 22.40)" built from points / opponentPoints / margin

export interface ColumnDef {
  key: string;
  title: string;
  type: ColumnType;
  /** Key of another value shown as grey parenthesized hint text, e.g. `10 (2021, 2023)`. */
  hint?: string;
  /** The column the record ranks by. */
  ranked?: boolean;
}

/** Column types the table can be sorted by (entity columns are resolved after the query, so they cannot be). */
export const SORTABLE_COLUMN_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  "int",
  "decimal",
  "points",
  "pct",
  "currency",
  "text",
  "player",
  "season",
  "week",
  "scoreline",
]);

export type RecordCategory = "overall" | "single-season" | "manager";

export interface RecordDef {
  id: string;
  title: string;
  /** One short line for the record picker (about 60 characters); `description` is the full text. */
  summary?: string;
  description?: string;
  category: RecordCategory;
  /** Heading shown above the record picker (the legacy category names). */
  section: string;
  grain: Grain;
  /** Which compiled query runs it; several records share one (differing in sortKey / direction). */
  engine: string;
  /** Key of the value that is ranked. */
  sortKey: string;
  direction: "asc" | "desc";
  columns: readonly ColumnDef[];
  filters: readonly FilterKey[];
  requires: readonly Requirement[];
  active: ActivePolicy;
  /**
   * Policy used instead of `active` when the ranked column is sorted against the record's own direction (e.g. the
   * "fewest" view of a "most" record, which must not show a partial season).
   */
  activeReverse?: ActivePolicy;
  /** Show every row (manager tables), not a paged top list. */
  displayAll?: boolean;
  /** Positions the Position filter offers (default: all); the record's query only ever covers these. */
  positionOptions?: readonly (typeof POSITIONS)[number][];
  /** Presets baked into the record (e.g. player "benched highest" = bench slot); the user can't change these. */
  preset?: Partial<Record<FilterKey, unknown>>;
  /** Filter values used when the request does not set them (unlike `preset`, the user can change these). */
  defaults?: Partial<Record<FilterKey, unknown>>;
  /** Minimum games to qualify (ratio records), enforced in SQL and reported. */
  qualifier?: { minGames: number };
  /** Transaction types that count for this record (doc §2: decided per record, not a user filter). */
  txTypes?: readonly ("trade" | "waiver" | "free_agent" | "commissioner")[];
  /** Name in the legacy site, for the parity report. */
  legacyName?: string;
  /**
   * Metric version (default 1). Part of the response-cache key: increment it whenever this record's definition,
   * query or output changes without the underlying data changing, so cached answers stop matching. Records that
   * share an engine do not share a version; if you change the shared engine code, bump every record that uses it.
   */
  version?: number;
  /**
   * The record reads every enabled season of the league, whatever the Seasons filter (e.g. it calibrates a scale on the
   * full history), so its cache key covers all of them and a change in any season invalidates it.
   */
  readsAllSeasons?: boolean;
}
