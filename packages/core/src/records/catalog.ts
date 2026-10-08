import { EXTRA_RECORDS } from "./catalog-extra";
import { RECORD_DESCRIPTIONS } from "./descriptions";
import { RECORD_SUMMARIES } from "./summaries";
import type { ActivePolicy, ColumnDef, FilterKey, RecordDef, Requirement } from "./types";

// Column building blocks ------------------------------------------------------------------------------------
const c = (
  key: string,
  title: string,
  type: ColumnDef["type"],
  extra: Partial<ColumnDef> = {}
): ColumnDef => ({
  key,
  title,
  type,
  ...extra,
});
const rank = (col: ColumnDef): ColumnDef => ({ ...col, ranked: true });

const TEAM = c("team", "Team / Manager", "team");
const MANAGER = c("manager", "Manager", "manager");
const WEEK = c("when", "Week", "week");
const OPPONENT = c("opponent", "Opponent", "opponent");
const SEASON = c("season", "Season", "season");

// Filter sets -----------------------------------------------------------------------------------------------
const GAME_FILTERS: FilterKey[] = ["seasons", "scope", "weeks", "franchise", "opponent", "onePer"];
const SEASON_FILTERS: FilterKey[] = [
  "seasons",
  "scope",
  "median",
  "franchise",
  "onePer",
  "minGames",
];
const CAREER_FILTERS: FilterKey[] = ["seasons", "scope", "median", "minGames"];
const PLAYER_FILTERS: FilterKey[] = [
  "seasons",
  "scope",
  "weeks",
  "franchise",
  "positions",
  "slots",
  "excludeZero",
  "countedOnly",
  "onePer",
];

type Base = Omit<
  RecordDef,
  "id" | "title" | "sortKey" | "direction" | "columns" | "filters" | "requires" | "active"
> &
  Partial<Pick<RecordDef, "filters" | "requires" | "active">>;

function rec(
  id: string,
  title: string,
  base: Base,
  sortKey: string,
  direction: "asc" | "desc",
  columns: readonly ColumnDef[],
  legacyName?: string
): RecordDef {
  return {
    id,
    title,
    filters: [],
    requires: [],
    active: "include",
    ...base,
    sortKey,
    direction,
    columns: columns.map((col) => (col.key === sortKey ? rank(col) : col)),
    ...(legacyName ? { legacyName } : {}),
  };
}

const req = (...r: Requirement[]) => r;

// ---- Overall: single event ----------------------------------------------------------------------------------
const gameBase = (section: string, extra: Partial<Base> = {}): Base => ({
  category: "overall",
  section,
  grain: "team_week",
  engine: "teamWeek",
  filters: GAME_FILTERS,
  ...extra,
});
const gameColumns = [TEAM, WEEK, OPPONENT, c("points", "Score", "scoreline")];

// Records that used to come as a "highest" and a "lowest" (or "largest" and "narrowest") version are one record
// now: the table sorts by any column, and sorting the ranked column the other way gives the other version. The old
// ids still work (RECORD_ALIASES in query.ts).
const singleWeekScores: RecordDef[] = [
  rec(
    "score.high",
    "Team score",
    gameBase("Matchup Scores"),
    "points",
    "desc",
    gameColumns,
    "Highest score"
  ),
  rec(
    "blowout",
    "Margin of victory",
    gameBase("Matchup Scores"),
    "margin",
    "desc",
    [TEAM, WEEK, OPPONENT, c("margin", "Score", "scoreline")],
    "Largest blowout"
  ),
  rec(
    "loss.high-score",
    "Highest scoring loss",
    gameBase("Matchup Scores"),
    "points",
    "desc",
    gameColumns,
    "Highest scoring loss"
  ),
  rec(
    "win.low-score",
    "Lowest scoring win",
    gameBase("Matchup Scores"),
    "points",
    "asc",
    gameColumns,
    "Lowest scoring win"
  ),
];

const teamwideColumns = (sort: string) =>
  [
    TEAM,
    WEEK,
    OPPONENT,
    c("teamwide", "Teamwide Score", "points"),
    c("points", "Actual Score", "points"),
    c("bench", "Bench Score", "points"),
  ].map((col) => (col.key === sort ? col : col));
const teamwide: RecordDef[] = [
  rec(
    "teamwide.high",
    "Teamwide score",
    gameBase("Teamwide Matchup Scores", { requires: req("playerData") }),
    "teamwide",
    "desc",
    teamwideColumns("teamwide"),
    "Highest teamwide score"
  ),
  rec(
    "bench.high",
    "Bench score",
    gameBase("Teamwide Matchup Scores", { requires: req("playerData") }),
    "bench",
    "desc",
    teamwideColumns("bench"),
    "Highest bench score"
  ),
];

const potentialColumns = [
  TEAM,
  WEEK,
  OPPONENT,
  c("potential", "Potential Score", "points"),
  c("points", "Actual Score", "points"),
  c("ratio", "Realized", "pct"),
];
const potentialBase = gameBase("Lineup Efficiency", { requires: req("playerData") });
const potential: RecordDef[] = [
  rec(
    "potential.high",
    "Potential points",
    potentialBase,
    "potential",
    "desc",
    potentialColumns,
    "Highest potential points"
  ),
  rec(
    "actual.high",
    "Actual points",
    potentialBase,
    "points",
    "desc",
    potentialColumns,
    "Highest actual points"
  ),
  rec(
    "ratio.high",
    "Realized points ratio",
    potentialBase,
    "ratio",
    "desc",
    potentialColumns,
    "Highest realized points ratio"
  ),
];

// Whole roster, starters only and bench only. Position, week, franchise and non-zero are user filters; zero-point
// weeks are left out by default (they would top the lowest-first view).
const PLAYER_WEEK_FILTERS: FilterKey[] = PLAYER_FILTERS.filter((f) => f !== "slots");
function playerWeekRecord(id: string, title: string, slots?: ("starter" | "bench")[]): RecordDef {
  return rec(
    id,
    title,
    {
      category: "overall",
      section: "Player Scores",
      grain: "player_week",
      engine: "playerWeek",
      filters: PLAYER_WEEK_FILTERS,
      requires: req("playerData"),
      ...(slots ? { preset: { slots } } : {}),
      defaults: { excludeZero: true },
    },
    "points",
    "desc",
    [
      c("player", "Player", "player"),
      TEAM,
      WEEK,
      c("position", "Pos", "text"),
      ...(slots ? [] : [c("slot", "Slot", "text")]),
      c("points", "Points", "points"),
    ]
  );
}
const players: RecordDef[] = [
  playerWeekRecord("player.roster.high", "Rostered player score"),
  playerWeekRecord("player.starter.high", "Starter score", ["starter"]),
  playerWeekRecord("player.bench.high", "Benched player score", ["bench"]),
];

const transactions: RecordDef[] = [
  rec(
    "waiver.faab-high",
    "Highest $ on a single waiver claim",
    {
      category: "overall",
      section: "Waivers & Trades",
      grain: "transaction",
      engine: "faabClaim",
      filters: ["seasons", "scope"],
      requires: req("transactions", "faab"),
      txTypes: ["waiver"],
    },
    "amount",
    "desc",
    [c("player", "Player", "player"), TEAM, WEEK, c("amount", "Bid", "currency")]
  ),
  rec(
    "draft.price-high",
    "Highest $ on a single draft pick",
    {
      category: "overall",
      section: "Draft Results",
      grain: "draft_pick",
      engine: "draftPrice",
      filters: ["seasons"],
      requires: req("draft", "auctionDraft"),
    },
    "amount",
    "desc",
    [
      c("player", "Player", "player"),
      TEAM,
      SEASON,
      c("pick", "Pick", "text"),
      c("amount", "Price", "currency"),
    ]
  ),
  rec(
    "moves.player",
    "Most moved player",
    {
      category: "overall",
      section: "Player Tenures",
      grain: "transaction",
      engine: "mostMoved",
      filters: ["seasons"],
      requires: req("transactions"),
    },
    "moves",
    "desc",
    [
      c("player", "Player", "player"),
      c("moves", "Moves", "int", { hint: "seasons" }),
      c("seasons", "Seasons", "seasons"),
    ]
  ),
  rec(
    "trade.largest",
    "Largest trade",
    {
      category: "overall",
      section: "Waivers & Trades",
      grain: "transaction",
      engine: "trade",
      filters: ["seasons", "scope"],
      requires: req("transactions"),
      txTypes: ["trade"],
    },
    "players",
    "desc",
    [
      c("teams", "Teams", "teams"),
      WEEK,
      c("players", "Players", "int"),
      c("picks", "Picks", "int"),
      c("faab", "$", "currency"),
      c("playerNames", "Players moved", "text"),
    ]
  ),
  rec(
    "trade.broadest",
    "Broadest trade",
    {
      category: "overall",
      section: "Waivers & Trades",
      grain: "transaction",
      engine: "trade",
      filters: ["seasons", "scope"],
      requires: req("transactions"),
      txTypes: ["trade"],
    },
    "teamCount",
    "desc",
    [
      c("teams", "Teams", "teams"),
      WEEK,
      c("teamCount", "# Teams", "int"),
      c("players", "Players", "int"),
      c("picks", "Picks", "int"),
    ]
  ),
];

const other: RecordDef[] = [
  rec(
    "bench-season.player",
    "Biggest benchwarmer",
    {
      category: "overall",
      section: "Player Scores",
      grain: "player_season",
      engine: "playerSeason",
      filters: ["seasons", "positions", "franchise", "combineTeams"],
      requires: req("playerData"),
      active: "flag",
      preset: { slots: ["bench"] },
    },
    "points",
    "desc",
    [
      c("player", "Player", "player"),
      TEAM,
      SEASON,
      c("position", "Pos", "text"),
      c("points", "Bench points", "points"),
      c("weeks", "Weeks", "int"),
    ]
  ),
  rec(
    "uncounted.best",
    "Best score that didn't count",
    {
      category: "overall",
      section: "Matchup Scores",
      grain: "team_week",
      engine: "uncounted",
      filters: ["seasons", "franchise"],
      requires: req("playerData"),
    },
    "points",
    "desc",
    [
      TEAM,
      WEEK,
      c("points", "Score", "points"),
      c("topPlayer", "Best player", "text"),
      c("why", "Why", "text"),
    ]
  ),
];

// ---- Single-season records (the season is a column; onePer = "season max") -------------------------------------
const seasonBase = (extra: Partial<Base> = {}): Base => ({
  category: "single-season",
  section: "Team Seasons",
  grain: "team_season",
  engine: "teamSeason",
  filters: SEASON_FILTERS,
  ...extra,
});
const seasonRecord = (c0: ColumnDef[]) => [TEAM, SEASON, ...c0];
const pfCols = seasonRecord([
  c("pf", "PF", "points"),
  c("pa", "PA", "points"),
  c("record", "Record", "text"),
  c("games", "G", "int"),
]);
const recordCols = seasonRecord([
  c("wins", "W", "int"),
  c("losses", "L", "int"),
  c("ties", "T", "int"),
  c("winPct", "Win %", "pct"),
  c("pf", "PF", "points"),
]);
const iqCols = seasonRecord([
  c("lineupIq", "Lineup IQ", "pct"),
  c("pf", "PF", "points"),
  c("potential", "Potential PF", "points"),
]);
const active = (a: ActivePolicy): Partial<Base> => ({ active: a });
const seasonRecords: RecordDef[] = [
  rec(
    "season.pf.high",
    "Points scored in a season",
    seasonBase({ active: "flag", activeReverse: "complete_only" }),
    "pf",
    "desc",
    pfCols
  ),
  rec(
    "season.pa.high",
    "Points against in a season",
    seasonBase({ active: "flag", activeReverse: "complete_only" }),
    "pa",
    "desc",
    pfCols
  ),
  rec(
    "season.wins.high",
    "Most wins in a season",
    seasonBase(active("flag")),
    "wins",
    "desc",
    recordCols
  ),
  rec(
    "season.losses.high",
    "Most losses in a season",
    seasonBase(active("flag")),
    "losses",
    "desc",
    recordCols
  ),
  rec(
    "season.winpct.high",
    "Win % in a season",
    seasonBase({ active: "complete_only", qualifier: { minGames: 10 } }),
    "winPct",
    "desc",
    recordCols
  ),
  rec(
    "season.iq.high",
    "Lineup IQ in a season",
    seasonBase({
      active: "complete_only",
      requires: req("playerData"),
      qualifier: { minGames: 10 },
    }),
    "lineupIq",
    "desc",
    iqCols
  ),
  rec(
    "season.player.high",
    "Highest scoring player season",
    {
      category: "single-season",
      section: "Team Seasons",
      grain: "player_season",
      engine: "playerSeason",
      filters: ["seasons", "scope", "positions", "franchise", "combineTeams", "onePer"],
      requires: req("playerData"),
      active: "flag",
    },
    "points",
    "desc",
    [
      c("player", "Player", "player"),
      TEAM,
      SEASON,
      c("position", "Pos", "text"),
      c("points", "Points", "points", { hint: "weeks" }),
      c("ppg", "PPG", "decimal"),
      c("ppgNonZero", "PPG (non-zero)", "decimal"),
      c("best", "Best", "points", { hint: "bestWeek" }),
      c("worst", "Worst", "points", { hint: "worstWeek" }),
    ]
  ),
];
const txSeasonBase = (extra: Partial<Base> = {}): Base => ({
  category: "single-season",
  section: "Transactions",
  grain: "team_season",
  engine: "seasonTransactions",
  filters: ["seasons", "scope", "franchise", "onePer"],
  requires: req("transactions"),
  ...extra,
});
const txCols = seasonRecord([
  c("trades", "Trades", "int"),
  c("claims", "Waiver claims", "int"),
  c("spent", "$ spent", "currency"),
]);
const txRecords: RecordDef[] = [
  rec(
    "season.trades.most",
    "Trades in a season",
    txSeasonBase({ active: "flag", activeReverse: "complete_only" }),
    "trades",
    "desc",
    txCols
  ),
  rec(
    "season.claims.most",
    "Waiver claims in a season",
    txSeasonBase({ active: "flag", activeReverse: "complete_only", txTypes: ["waiver"] }),
    "claims",
    "desc",
    txCols
  ),
  rec(
    "season.faab.most",
    "$ spent on waiver claims in a season",
    txSeasonBase({
      active: "flag",
      activeReverse: "complete_only",
      requires: req("transactions", "faab"),
      txTypes: ["waiver"],
    }),
    "spent",
    "desc",
    txCols
  ),
  rec(
    "season.retention.high",
    "% of drafted players kept to season's end",
    {
      category: "single-season",
      section: "Draft Results",
      grain: "team_season",
      engine: "draftRetention",
      filters: ["seasons", "franchise", "onePer"],
      requires: req("draft", "transactions"),
      active: "complete_only",
    },
    "retentionPct",
    "desc",
    seasonRecord([
      c("retentionPct", "Kept", "pct", { hint: "kept" }),
      c("kept", "Kept", "int"),
      c("drafted", "Drafted", "int"),
    ])
  ),
];

// ---- Manager (franchise career) records -------------------------------------------------------------------------
const careerBase = (section: string, engine: string, extra: Partial<Base> = {}): Base => ({
  category: "manager",
  section,
  grain: "franchise_career",
  engine,
  filters: CAREER_FILTERS,
  displayAll: true,
  ...extra,
});
const standingsCols = [
  MANAGER,
  c("years", "YiL", "int"),
  c("wins", "Wins", "int"),
  c("losses", "Losses", "int"),
  c("ties", "Ties", "int"),
  c("winPct", "Win %", "pct"),
  c("winStreak", "Longest Win Streak", "int", { hint: "winStreakSeasons" }),
  c("lossStreak", "Longest Loss Streak", "int", { hint: "lossStreakSeasons" }),
];
const standings: RecordDef[] = [
  rec(
    "career.wins",
    "Most wins",
    careerBase("Standings", "careerStandings", { filters: CAREER_FILTERS }),
    "wins",
    "desc",
    standingsCols,
    "Most wins"
  ),
  rec(
    "career.losses",
    "Most losses",
    careerBase("Standings", "careerStandings"),
    "losses",
    "desc",
    standingsCols,
    "Most losses"
  ),
  rec(
    "career.years",
    "Most years in league (YiL)",
    careerBase("Standings", "careerStandings"),
    "years",
    "desc",
    standingsCols,
    "Most years in league (YiL)"
  ),
  rec(
    "career.winpct",
    "Highest win percentage",
    careerBase("Standings", "careerStandings", { qualifier: { minGames: 10 } }),
    "winPct",
    "desc",
    standingsCols,
    "Highest win percentage"
  ),
  rec(
    "career.win-streak",
    "Highest win streak",
    careerBase("Standings", "careerStandings"),
    "winStreak",
    "desc",
    standingsCols,
    "Highest win streak"
  ),
  rec(
    "career.loss-streak",
    "Highest loss streak",
    careerBase("Standings", "careerStandings"),
    "lossStreak",
    "desc",
    standingsCols,
    "Highest loss streak"
  ),
];

const placementCols = [
  MANAGER,
  c("bestPlace", "Highest Placement", "int", { hint: "bestPlaceSeasons" }),
  c("worstPlace", "Lowest Placement", "int", { hint: "worstPlaceSeasons" }),
  c("placePct", "Weighted Placement", "pct"),
  c("playoffs", "Playoff Appearances", "int"),
  c("toiletBowls", "Toilet Bowl Appearances", "int"),
];
const placementBase = careerBase("Placements", "careerPlacements", {
  filters: ["seasons"],
  active: "complete_only",
  version: 2, // 2: the average placement column became the league-size-weighted placement (placePct)
});
const placements: RecordDef[] = [
  rec(
    "career.place.avg",
    "Highest average placement",
    placementBase,
    "placePct",
    "desc",
    placementCols,
    "Highest average placement"
  ),
  rec(
    "career.place.best",
    "Highest placement",
    placementBase,
    "bestPlace",
    "asc",
    placementCols,
    "Highest placement"
  ),
  rec(
    "career.place.worst",
    "Lowest placement",
    placementBase,
    "worstPlace",
    "desc",
    placementCols,
    "Lowest placement"
  ),
  rec(
    "career.playoffs",
    "Most playoff appearances",
    placementBase,
    "playoffs",
    "desc",
    placementCols,
    "Most playoff appearances"
  ),
  rec(
    "career.toilet-bowls",
    "Most toilet bowl appearances",
    placementBase,
    "toiletBowls",
    "desc",
    placementCols,
    "Most toilet bowl appearances"
  ),
];

const lineupCols = [
  MANAGER,
  c("perfect", "Perfect Lineups", "int"),
  c("missed", "Total Missed Points", "points"),
  c("lineupIq", "Lineup IQ", "pct"),
];
const lineupBase = careerBase("Lineup IQ", "careerLineups", {
  filters: ["seasons", "scope"],
  requires: req("playerData"),
});
const lineups: RecordDef[] = [
  rec(
    "career.perfect",
    "Most perfect lineups",
    lineupBase,
    "perfect",
    "desc",
    lineupCols,
    "Most perfect lineups"
  ),
  rec(
    "career.missed",
    "Fewest total missed points",
    lineupBase,
    "missed",
    "asc",
    lineupCols,
    "Fewest total missed points"
  ),
  rec(
    "career.iq",
    "Highest lineup IQ",
    lineupBase,
    "lineupIq",
    "desc",
    lineupCols,
    "Highest lineup IQ"
  ),
];

const scoringCols = [
  MANAGER,
  c("highScore", "Highest Score", "points", { hint: "highScoreWhen" }),
  c("lowScore", "Lowest Score", "points", { hint: "lowScoreWhen" }),
  c("pf", "PF", "points"),
  c("pa", "PA", "points"),
  c("games", "G", "int"),
  c("pfpg", "PFPG", "decimal"),
  c("papg", "PAPG", "decimal"),
];
const scoringBase = careerBase("Scoring", "careerScoring", { filters: ["seasons", "scope"] });
const scoring: RecordDef[] = [
  rec(
    "career.score.high",
    "Highest highest score",
    scoringBase,
    "highScore",
    "desc",
    scoringCols,
    "Highest highest score"
  ),
  rec(
    "career.score.low",
    "Lowest lowest score",
    scoringBase,
    "lowScore",
    "asc",
    scoringCols,
    "Lowest lowest score"
  ),
  rec(
    "career.pf",
    "Highest total points forward (PF)",
    scoringBase,
    "pf",
    "desc",
    scoringCols,
    "Highest total points forward (PF)"
  ),
  rec(
    "career.pa",
    "Highest total points against (PA)",
    scoringBase,
    "pa",
    "desc",
    scoringCols,
    "Highest total points against (PA)"
  ),
  rec(
    "career.pfpg",
    "Highest average points forward per game (PFPG)",
    scoringBase,
    "pfpg",
    "desc",
    scoringCols,
    "Highest average points forward per game (PFPG)"
  ),
  rec(
    "career.papg",
    "Highest average points against per game (PAPG)",
    scoringBase,
    "papg",
    "desc",
    scoringCols,
    "Highest average points against per game (PAPG)"
  ),
];

const careerTxCols = [
  MANAGER,
  c("trades", "Trades", "int"),
  c("claims", "Waiver claims", "int"),
  c("spent", "$ spent", "currency"),
];
const careerTxBase = careerBase("Transactions", "careerTransactions", {
  filters: ["seasons", "scope"],
  requires: req("transactions"),
  txTypes: ["waiver"],
});
const careerTx: RecordDef[] = [
  rec("career.trades", "Most trades", careerTxBase, "trades", "desc", careerTxCols),
  rec("career.claims", "Most waiver claims", careerTxBase, "claims", "desc", careerTxCols),
  rec(
    "career.spent",
    "Most $ spent on waiver claims",
    { ...careerTxBase, requires: req("transactions", "faab") },
    "spent",
    "desc",
    careerTxCols
  ),
];

const ALL_RECORDS: readonly RecordDef[] = [
  ...singleWeekScores,
  ...teamwide,
  ...potential,
  ...players,
  ...transactions,
  ...other,
  ...seasonRecords,
  ...txRecords,
  ...standings,
  ...placements,
  ...lineups,
  ...scoring,
  ...careerTx,
  ...EXTRA_RECORDS,
];

/** Every record has a description (its own, or the one in descriptions.ts) and a picker summary. */
export const RECORD_CATALOG: readonly RecordDef[] = ALL_RECORDS.map((r) => ({
  ...r,
  description: r.description ?? RECORD_DESCRIPTIONS[r.id],
  summary: r.summary ?? RECORD_SUMMARIES[r.id],
}));

const byId = new Map(RECORD_CATALOG.map((r) => [r.id, r]));
export const getRecordDef = (id: string): RecordDef | undefined => byId.get(id);
