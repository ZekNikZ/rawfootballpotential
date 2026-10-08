import type { ColumnDef, FilterKey, RecordDef, Requirement } from "./types";

// The additional records of doc 4.5, in the same shape as catalog.ts. Definitions that needed a decision the doc
// left open are written up in doc 3.11.3 ("Additional records as built").

const c = (
  key: string,
  title: string,
  type: ColumnDef["type"],
  extra: Partial<ColumnDef> = {}
): ColumnDef => ({ key, title, type, ...extra });

const TEAM = c("team", "Team / Manager", "team");
const MANAGER = c("manager", "Manager", "manager");
const WEEK = c("when", "Week", "week");
const OPPONENT = c("opponent", "Opponent", "opponent");
const SEASON = c("season", "Season", "season");
const SCORE = c("points", "Score", "scoreline");

const GAME_FILTERS: FilterKey[] = ["seasons", "scope", "weeks", "franchise", "opponent", "onePer"];
const SEASON_FILTERS: FilterKey[] = ["seasons", "scope", "franchise", "onePer", "minGames"];
const CAREER_FILTERS: FilterKey[] = ["seasons", "scope"];

type Base = Omit<
  RecordDef,
  "id" | "title" | "sortKey" | "direction" | "columns" | "requires" | "active" | "filters"
> &
  Partial<Pick<RecordDef, "requires" | "active" | "filters">>;

function rec(
  id: string,
  title: string,
  base: Base,
  sortKey: string,
  direction: "asc" | "desc",
  columns: readonly ColumnDef[],
  description?: string
): RecordDef {
  return {
    id,
    title,
    filters: [],
    requires: [],
    active: "include",
    ...base,
    ...(description ? { description } : {}),
    sortKey,
    direction,
    columns: columns.map((col) => (col.key === sortKey ? { ...col, ranked: true } : col)),
  };
}
const req = (...r: Requirement[]) => r;

// ---- Overall: single games ------------------------------------------------------------------------------------
const gameBase = (section: string, extra: Partial<Base> = {}): Base => ({
  category: "overall",
  section,
  grain: "team_week",
  engine: "extraTeamWeek",
  filters: GAME_FILTERS,
  ...extra,
});

const luckCols = [TEAM, WEEK, OPPONENT, SCORE, c("rankText", "Weekly rank", "text")];
const leftCols = [
  TEAM,
  WEEK,
  OPPONENT,
  SCORE,
  c("left", "Left on bench", "points"),
  c("potential", "Best lineup", "points"),
];

const luckAndRegret: RecordDef[] = [
  rec(
    "luck.unluckiest-loss",
    "Unluckiest loss",
    gameBase("Luck and Regret"),
    "rankText",
    "asc",
    luckCols,
    "A loss with one of the week's highest scores. Ranked by weekly score rank, then by score."
  ),
  rec(
    "luck.luckiest-win",
    "Luckiest win",
    gameBase("Luck and Regret"),
    "rankText",
    "desc",
    luckCols,
    "A win with one of the week's lowest scores. Ranked by weekly score rank, then by lowest score."
  ),
  rec(
    "shouldve-won",
    "Should've won",
    gameBase("Luck and Regret", { requires: req("playerData") }),
    "left",
    "desc",
    leftCols,
    "Losses that the optimal lineup would have won, ranked by points left on the bench."
  ),
  rec(
    "contender.eliminated",
    "Coulda been a contender",
    gameBase("Luck and Regret", {
      filters: ["seasons", "weeks", "franchise", "opponent", "onePer"],
      requires: req("playerData"),
    }),
    "left",
    "desc",
    leftCols,
    "A team's first playoff loss, when a perfect lineup would have survived it."
  ),
  rec(
    "median.won-h2h-lost",
    "Won the game, lost the median",
    gameBase("Luck and Regret"),
    "gap",
    "asc",
    [TEAM, WEEK, OPPONENT, SCORE, c("median", "Median", "points"), c("gap", "Vs median", "points")],
    "Won the head-to-head but finished below the week's median (median leagues). Ranked by the gap to the median."
  ),
  rec(
    "median.lost-h2h-won",
    "Lost the game, won the median",
    gameBase("Luck and Regret"),
    "gap",
    "desc",
    [TEAM, WEEK, OPPONENT, SCORE, c("median", "Median", "points"), c("gap", "Vs median", "points")],
    "Lost the head-to-head but finished above the week's median (median leagues). Ranked by the gap to the median."
  ),
  rec(
    "heartbreak.playoff-loss",
    "Closest playoff loss",
    gameBase("Luck and Regret", {
      filters: ["seasons", "weeks", "franchise", "opponent", "onePer"],
      preset: { scope: "playoffs" },
    }),
    "margin",
    "asc",
    [TEAM, WEEK, OPPONENT, c("margin", "Score", "scoreline")],
    "Playoff games lost by the smallest margin."
  ),
];

const projections: RecordDef[] = [
  rec(
    "projection.boom",
    "Biggest team boom",
    gameBase("Projections", { requires: req("playerData", "projections") }),
    "delta",
    "desc",
    [
      TEAM,
      WEEK,
      OPPONENT,
      SCORE,
      c("projected", "Projected", "points"),
      c("delta", "Over", "points"),
    ],
    "Team score above the starters' projections."
  ),
  rec(
    "projection.bust",
    "Biggest team bust",
    gameBase("Projections", { requires: req("playerData", "projections") }),
    "delta",
    "asc",
    [
      TEAM,
      WEEK,
      OPPONENT,
      SCORE,
      c("projected", "Projected", "points"),
      c("delta", "Over", "points"),
    ],
    "Team score below the starters' projections."
  ),
  rec(
    "projection.upset",
    "Biggest upset",
    gameBase("Projections", { requires: req("playerData", "projections") }),
    "deficit",
    "desc",
    [
      TEAM,
      WEEK,
      OPPONENT,
      SCORE,
      c("projected", "Projected", "points"),
      c("opponentProjected", "Opp. projected", "points"),
      c("deficit", "Projected deficit", "points"),
    ],
    "A win despite the largest projected deficit."
  ),
];

const playerProjection = (id: string, title: string, direction: "asc" | "desc", text: string) =>
  rec(
    id,
    title,
    {
      category: "overall",
      section: "Projections",
      grain: "player_week",
      engine: "playerProjection",
      filters: ["seasons", "scope", "weeks", "franchise", "positions", "onePer"],
      requires: req("playerData", "projections"),
      preset: { slots: ["starter"] },
    },
    "delta",
    direction,
    [
      c("player", "Player", "player"),
      TEAM,
      WEEK,
      c("position", "Pos", "text"),
      c("points", "Points", "points"),
      c("projected", "Projected", "points"),
      c("delta", "Over", "points"),
    ],
    text
  );
const playerProjections: RecordDef[] = [
  playerProjection(
    "projection.player.boom",
    "Biggest player boom",
    "desc",
    "A starter's points above his projection. Starters who were on a bye or inactive are left out."
  ),
  playerProjection(
    "projection.player.bust",
    "Biggest player bust",
    "asc",
    "A starter's points below his projection. Starters who were on a bye or inactive are left out."
  ),
];

const gameOther: RecordDef[] = [
  rec(
    "oneman.high",
    "One-man show",
    gameBase("Other", { requires: req("playerData") }),
    "share",
    "desc",
    [
      TEAM,
      WEEK,
      OPPONENT,
      SCORE,
      c("topPlayer", "Player", "text"),
      c("topPoints", "His points", "points"),
      c("share", "Share of starter points", "pct"),
    ],
    "The highest share of a team's starter points scored by one player."
  ),
  rec(
    "era.score",
    "Highest score, era-adjusted",
    gameBase("Other"),
    "zscore",
    "desc",
    [TEAM, WEEK, OPPONENT, SCORE, c("zscore", "Weekly z-score", "decimal")],
    "How far above that week's average a score was, in standard deviations. Comparable across scoring changes."
  ),
];

const deadCols = [
  c("deadStarters", "Out", "int"),
  c("byeStarters", "Bye", "int"),
  c("pointsLost", "Lost", "points"),
];
const nflBase = (extra: Partial<Base> = {}): Base =>
  gameBase("NFL Byes and Inactives", { requires: req("playerData"), ...extra });
const nflReference: RecordDef[] = [
  rec(
    "asleep.week",
    "Asleep at the wheel: most starters out in a week",
    nflBase(),
    "deadStarters",
    "desc",
    [TEAM, WEEK, OPPONENT, SCORE, ...deadCols],
    "Starters whose NFL team was on a bye or who were not active. Ties go to the more points lost."
  ),
  rec(
    "asleep.lost-week",
    "Asleep at the wheel: most points lost in a week",
    nflBase(),
    "pointsLost",
    "desc",
    [TEAM, WEEK, OPPONENT, SCORE, ...deadCols],
    "What the best live bench players eligible for the dead slots would have scored."
  ),
  rec(
    "asleep.blunder",
    "Bye-week blunder that cost a game",
    nflBase(),
    "pointsLost",
    "desc",
    [TEAM, WEEK, OPPONENT, SCORE, ...deadCols, c("flipBy", "Would have won by", "points")],
    "Losses that swapping the bye or inactive starters for bench players would have won."
  ),
  rec(
    "bye.survivor",
    "Bye-week survivor",
    nflBase(),
    "points",
    "desc",
    [TEAM, WEEK, OPPONENT, SCORE, c("byeStarters", "Bye", "int")],
    "The highest score in a week with at least two starters on a bye."
  ),
  rec(
    "bye.heaviest",
    "Heaviest bye week survived",
    nflBase(),
    "byeStarters",
    "desc",
    [TEAM, WEEK, OPPONENT, SCORE, c("byeStarters", "Bye", "int")],
    "The most starters on a bye in a game the team still won."
  ),
  rec(
    "nfl.stack",
    "NFL game stack",
    {
      category: "overall",
      section: "NFL Byes and Inactives",
      grain: "team_week",
      engine: "nflStack",
      filters: GAME_FILTERS,
      requires: req("playerData"),
    },
    "stackPoints",
    "desc",
    [
      TEAM,
      WEEK,
      c("nflGame", "NFL game", "text"),
      c("players", "Starters", "int"),
      c("stackPoints", "Points", "points"),
      c("share", "Share of team", "pct"),
    ],
    "The most starter points from players in a single NFL game."
  ),
];

// ---- Single season --------------------------------------------------------------------------------------------
const seasonBase = (section: string, engine: string, extra: Partial<Base> = {}): Base => ({
  category: "single-season",
  section,
  grain: "team_season",
  engine,
  filters: SEASON_FILTERS,
  ...extra,
});
const seasonLuckCols = [
  TEAM,
  SEASON,
  c("record", "Record", "text"),
  c("allPlay", "All-play", "text"),
  c("allPlayPct", "All-play %", "pct"),
  c("luck", "Luck (wins)", "decimal"),
];
const allplay: RecordDef[] = [
  rec(
    "season.allplay.high",
    "Best all-play record",
    seasonBase("Luck and Schedule", "allPlay", {
      active: "flag",
      qualifier: { minGames: 8 },
      preset: { scope: "regular" },
      filters: ["seasons", "franchise", "onePer", "minGames"],
    }),
    "allPlayPct",
    "desc",
    seasonLuckCols,
    "Win % if every team had played every other team every week."
  ),
  rec(
    "season.luck.high",
    "Luckiest season",
    seasonBase("Luck and Schedule", "allPlay", {
      active: "flag",
      qualifier: { minGames: 8 },
      preset: { scope: "regular" },
      filters: ["seasons", "franchise", "onePer", "minGames"],
    }),
    "luck",
    "desc",
    seasonLuckCols,
    "Actual wins minus the wins the all-play record predicts."
  ),
  rec(
    "season.luck.low",
    "Unluckiest season",
    seasonBase("Luck and Schedule", "allPlay", {
      active: "complete_only",
      qualifier: { minGames: 8 },
      preset: { scope: "regular" },
      filters: ["seasons", "franchise", "onePer", "minGames"],
    }),
    "luck",
    "asc",
    seasonLuckCols,
    "Actual wins minus the wins the all-play record predicts."
  ),
];
const scheduleCols = [
  TEAM,
  SEASON,
  c("record", "Record with that schedule", "text"),
  c("winPct", "Win %", "pct"),
  c("actual", "Actual record", "text"),
  c("schedule", "Schedule of", "opponent"),
];
const schedule: RecordDef[] = [
  rec(
    "season.schedule.best",
    "Best possible record",
    seasonBase("Luck and Schedule", "scheduleSwap", {
      active: "complete_only",
      filters: ["seasons", "franchise", "onePer"],
    }),
    "winPct",
    "desc",
    scheduleCols,
    "Your regular-season scores against each other team's schedule. Games where that schedule faced you are skipped."
  ),
  rec(
    "season.schedule.worst",
    "Worst possible record",
    seasonBase("Luck and Schedule", "scheduleSwap", {
      active: "complete_only",
      filters: ["seasons", "franchise", "onePer"],
    }),
    "winPct",
    "asc",
    scheduleCols,
    "Your regular-season scores against each other team's schedule. Games where that schedule faced you are skipped."
  ),
];

const weeklyCols = [
  TEAM,
  SEASON,
  c("count", "Weeks", "int"),
  c("weeks", "Of", "int"),
  c("record", "Record", "text"),
];
const weeklyCounts: RecordDef[] = [
  rec(
    "season.top-scorer",
    "Most weeks as the top scorer",
    seasonBase("Weekly Highs and Lows", "weeklyCounts", { active: "flag" }),
    "count",
    "desc",
    weeklyCols,
    "Weeks with the league's highest score."
  ),
  rec(
    "season.bottom-scorer",
    "Most weeks as the lowest scorer",
    seasonBase("Weekly Highs and Lows", "weeklyCounts", { active: "flag" }),
    "count",
    "desc",
    weeklyCols,
    "Weeks with the league's lowest score."
  ),
];

const standingCols = [
  TEAM,
  SEASON,
  c("seed", "Seed", "int"),
  c("finalPlace", "Finish", "int"),
  c("record", "Record", "text"),
  c("pf", "PF", "points"),
];
const seedFinish: RecordDef[] = [
  rec(
    "seed.lowest-champion",
    "Lowest seed to win the title",
    seasonBase("Seeds and Finishes", "seedFinish", {
      active: "complete_only",
      preset: { scope: "regular" },
      filters: ["seasons", "franchise", "onePer"],
    }),
    "seed",
    "desc",
    standingCols
  ),
  rec(
    "seed.top-worst",
    "Worst finish by a top seed",
    seasonBase("Seeds and Finishes", "seedFinish", {
      active: "complete_only",
      preset: { scope: "regular" },
      filters: ["seasons", "franchise", "onePer"],
    }),
    "finalPlace",
    "desc",
    standingCols
  ),
  rec(
    "seed.worst-record-playoffs",
    "Worst record to make the playoffs",
    seasonBase("Seeds and Finishes", "seedFinish", {
      active: "complete_only",
      preset: { scope: "regular" },
      filters: ["seasons", "median", "franchise", "onePer"],
    }),
    "winPct",
    "asc",
    [...standingCols, c("winPct", "Win %", "pct")]
  ),
  rec(
    "seed.best-record-missed",
    "Best record to miss the playoffs",
    seasonBase("Seeds and Finishes", "seedFinish", {
      active: "complete_only",
      preset: { scope: "regular" },
      filters: ["seasons", "median", "franchise", "onePer"],
    }),
    "winPct",
    "desc",
    [...standingCols, c("winPct", "Win %", "pct")]
  ),
  rec(
    "champ.worst",
    "Worst champion",
    seasonBase("Seeds and Finishes", "seedFinish", {
      active: "complete_only",
      preset: { scope: "regular" },
      filters: ["seasons", "franchise", "onePer"],
    }),
    "pf",
    "asc",
    [...standingCols, c("allPlayPct", "All-play %", "pct")],
    "The champion with the fewest regular-season points."
  ),
  rec(
    "champ.best-non",
    "Best team that didn't win the title",
    seasonBase("Seeds and Finishes", "seedFinish", {
      active: "complete_only",
      preset: { scope: "regular" },
      filters: ["seasons", "franchise", "onePer"],
    }),
    "pf",
    "desc",
    [...standingCols, c("allPlayPct", "All-play %", "pct")],
    "The non-champion with the most regular-season points."
  ),
];

const trajectoryCols = [
  TEAM,
  SEASON,
  c("finalPlace", "Finish", "int"),
  c("weeksFirst", "Weeks in 1st", "int"),
  c("record", "Record", "text"),
];
const trajectory: RecordDef[] = [
  rec(
    "trajectory.weeks-first",
    "Most weeks in first place without winning the title",
    seasonBase("Seeds and Finishes", "trajectory", {
      active: "complete_only",
      filters: ["seasons", "franchise", "onePer"],
    }),
    "weeksFirst",
    "desc",
    trajectoryCols,
    "Weeks leading the regular-season standings by a team that did not win the title."
  ),
  rec(
    "trajectory.fall",
    "Biggest fall from first place",
    seasonBase("Seeds and Finishes", "trajectory", {
      active: "complete_only",
      filters: ["seasons", "weeks", "franchise", "onePer"],
    }),
    "finalPlace",
    "desc",
    trajectoryCols,
    "The worst finish by a team that was in first place after the last regular-season week (or after any week in the weeks filter)."
  ),
];

const draftClass = (id: string, title: string, direction: "asc" | "desc") =>
  rec(
    id,
    title,
    seasonBase("Draft", "draftClass", {
      active: direction === "asc" ? "complete_only" : "flag",
      filters: ["seasons", "scope", "franchise", "onePer"],
      requires: req("playerData", "draft"),
    }),
    "classPoints",
    direction,
    [
      TEAM,
      SEASON,
      c("classPoints", "Starter points", "points"),
      c("picks", "Picks", "int"),
      c("starters", "Started", "int"),
      c("bestPick", "Best pick", "text"),
    ],
    "Starter points the team got from the players it drafted that season, while it rostered them."
  );
const draftClasses: RecordDef[] = [
  draftClass("draft.class.best", "Best draft class", "desc"),
  draftClass("draft.class.worst", "Worst draft class", "asc"),
];

// ---- Overall: players, drafts, transactions ---------------------------------------------------------------------
const pickupBase = (section: string, extra: Partial<Base> = {}): Base => ({
  category: "overall",
  section,
  grain: "transaction",
  engine: "pickup",
  filters: ["seasons", "scope", "franchise", "onePer"],
  requires: req("transactions", "playerData"),
  ...extra,
});
const pickupCols = [
  c("player", "Player", "player"),
  TEAM,
  WEEK,
  c("amount", "Bid", "currency"),
  c("starterPoints", "Starter points", "points"),
  c("starts", "Starts", "int"),
];
const pickups: RecordDef[] = [
  rec(
    "pickup.best",
    "Best waiver pickup",
    pickupBase("Pickups and Trades"),
    "starterPoints",
    "desc",
    pickupCols,
    "Points a claimed player scored as a starter for the team that claimed him, until it let him go."
  ),
  rec(
    "pickup.value",
    "Best value pickup",
    pickupBase("Pickups and Trades", { requires: req("transactions", "playerData", "faab") }),
    "pointsPerDollar",
    "desc",
    [...pickupCols, c("pointsPerDollar", "Points per $", "decimal")],
    "Starter points per FAAB dollar, for winning bids of at least $1."
  ),
  rec(
    "pickup.faab-per-point",
    "Most FAAB per point",
    pickupBase("Pickups and Trades", { requires: req("transactions", "playerData", "faab") }),
    "dollarsPerPoint",
    "desc",
    [...pickupCols, c("dollarsPerPoint", "$ per point", "decimal")],
    "FAAB dollars per starter point. A claim that scored under one point counts as one."
  ),
  rec(
    "drop-regret",
    "Drop regret",
    pickupBase("Pickups and Trades", { grain: "player_season", engine: "dropRegret" }),
    "points",
    "desc",
    [
      c("player", "Player", "player"),
      TEAM,
      c("droppedWeek", "Dropped", "week"),
      c("points", "Starter points for others since", "points"),
      c("startedFor", "Started for", "text"),
    ],
    "Points a dropped player scored as a starter for other teams over the rest of that season."
  ),
];
const tradeCols = [
  TEAM,
  WEEK,
  c("got", "Got", "text"),
  c("sidePoints", "Starter points", "points"),
  c("otherPoints", "Other side", "points"),
  c("difference", "Difference", "points"),
];
const trades: RecordDef[] = [
  rec(
    "trade.best",
    "Best trade",
    pickupBase("Pickups and Trades", { grain: "transaction", engine: "tradeValue" }),
    "sidePoints",
    "desc",
    tradeCols,
    "Starter points the players one side received scored for it over the rest of the season."
  ),
  rec(
    "trade.lopsided",
    "Most lopsided trade",
    pickupBase("Pickups and Trades", { grain: "transaction", engine: "tradeValue" }),
    "difference",
    "desc",
    tradeCols,
    "The gap between the winning side's starter points and the other side's, for trades where each side received players."
  ),
];

const stintCols = [
  c("player", "Player", "player"),
  TEAM,
  c("weeks", "Weeks", "int"),
  c("span", "From / to", "text"),
];
const tenureRecords: RecordDef[] = [
  rec(
    "journeyman.career",
    "Journeyman: most franchises",
    {
      category: "overall",
      section: "Players",
      grain: "player_season",
      engine: "journeyman",
      filters: ["seasons"],
      requires: req("playerData"),
    },
    "franchises",
    "desc",
    [
      c("player", "Player", "player"),
      c("franchises", "Franchises", "int"),
      c("stints", "Stints", "int"),
      c("seasons", "Seasons", "seasons"),
    ],
    "The player rostered by the most different franchises."
  ),
  rec(
    "journeyman.season",
    "Journeyman: most teams in a season",
    {
      category: "overall",
      section: "Players",
      grain: "player_season",
      engine: "journeyman",
      filters: ["seasons", "onePer"],
      requires: req("playerData"),
    },
    "franchises",
    "desc",
    [
      c("player", "Player", "player"),
      c("season", "Season", "season"),
      c("franchises", "Teams", "int"),
      c("stints", "Stints", "int"),
    ],
    "The player rostered by the most different teams within one season."
  ),
  rec(
    "loyalty.stint",
    "Loyalty: longest stint with one franchise",
    {
      category: "overall",
      section: "Players",
      grain: "player_season",
      engine: "loyalty",
      filters: ["seasons", "franchise"],
      requires: req("playerData"),
    },
    "weeks",
    "desc",
    stintCols,
    "Consecutive weeks on one franchise's roster, across seasons."
  ),
  rec(
    "boomerang.longest",
    "Boomerang: longest time away",
    {
      category: "overall",
      section: "Players",
      grain: "player_season",
      engine: "loyalty",
      filters: ["seasons", "franchise"],
      requires: req("playerData"),
    },
    "weeksAway",
    "desc",
    [
      c("player", "Player", "player"),
      TEAM,
      c("weeksAway", "Weeks away", "int"),
      c("span", "Gone / back", "text"),
    ],
    "A player a franchise let go and later got back, ranked by the weeks he was gone."
  ),
];

const drafts: RecordDef[] = [
  rec(
    "draft.steal",
    "Draft steal",
    {
      category: "overall",
      section: "Draft",
      grain: "draft_pick",
      engine: "draftValue",
      filters: ["seasons", "franchise", "onePer"],
      requires: req("playerData", "draft"),
      active: "complete_only",
    },
    "gain",
    "desc",
    [
      c("player", "Player", "player"),
      TEAM,
      SEASON,
      c("pick", "Pick", "text"),
      c("points", "Season points", "points"),
      c("finish", "Finished as #", "int"),
      c("gain", "Places gained", "int"),
    ],
    "Picks that outscored their draft slot most, among QB, RB, WR and TE drafted in the same draft."
  ),
  rec(
    "draft.bust",
    "Draft bust",
    {
      category: "overall",
      section: "Draft",
      grain: "draft_pick",
      engine: "draftValue",
      filters: ["seasons", "franchise", "onePer"],
      requires: req("playerData", "draft"),
      active: "complete_only",
    },
    "gain",
    "asc",
    [
      c("player", "Player", "player"),
      TEAM,
      SEASON,
      c("pick", "Pick", "text"),
      c("points", "Season points", "points"),
      c("finish", "Finished as #", "int"),
      c("gain", "Places gained", "int"),
    ],
    "Picks that fell furthest short of their draft slot, among QB, RB, WR and TE drafted in the same draft."
  ),
  rec(
    "draft.best-by-round",
    "Best pick of each round",
    {
      category: "overall",
      section: "Draft",
      grain: "draft_pick",
      engine: "draftValue",
      filters: ["seasons", "franchise"],
      requires: req("playerData", "draft"),
      active: "complete_only",
    },
    "round",
    "asc",
    [
      c("round", "Round", "int"),
      c("player", "Player", "player"),
      TEAM,
      SEASON,
      c("pick", "Pick", "text"),
      c("points", "Season points", "points"),
    ],
    "The highest-scoring player picked in each round, across the selected seasons."
  ),
  rec(
    "auction.value",
    "Best auction value",
    {
      category: "overall",
      section: "Draft",
      grain: "draft_pick",
      engine: "draftValue",
      filters: ["seasons", "franchise", "onePer"],
      requires: req("playerData", "draft", "auctionDraft"),
      active: "complete_only",
    },
    "pointsPerDollar",
    "desc",
    [
      c("player", "Player", "player"),
      TEAM,
      SEASON,
      c("amount", "Price", "currency"),
      c("points", "Season points", "points"),
      c("pointsPerDollar", "Points per $", "decimal"),
    ],
    "Season points per auction dollar, for players who cost at least $1."
  ),
  rec(
    "auction.bust",
    "Worst auction value",
    {
      category: "overall",
      section: "Draft",
      grain: "draft_pick",
      engine: "draftValue",
      filters: ["seasons", "franchise", "onePer"],
      requires: req("playerData", "draft", "auctionDraft"),
      active: "complete_only",
    },
    "dollarsPerPoint",
    "desc",
    [
      c("player", "Player", "player"),
      TEAM,
      SEASON,
      c("amount", "Price", "currency"),
      c("points", "Season points", "points"),
      c("dollarsPerPoint", "$ per point", "decimal"),
    ],
    "Auction dollars per season point. A player who scored under one point counts as one."
  ),
];

// ---- Overall: head to head ------------------------------------------------------------------------------------
const rivalryBase = (extra: Partial<Base> = {}): Base => ({
  category: "overall",
  section: "Rivalries",
  grain: "franchise_career",
  engine: "rivalry",
  filters: ["seasons", "scope", "minGames"],
  ...extra,
});
const rivalryCols = [
  c("team", "Team / Manager", "team"),
  c("opponent", "Opponent", "opponent"),
  c("games", "Games", "int"),
  c("record", "Record", "text"),
  c("winPct", "Win %", "pct"),
];
const rivalries: RecordDef[] = [
  rec(
    "rivalry.most-played",
    "Most-played pairing",
    rivalryBase(),
    "games",
    "desc",
    rivalryCols,
    "Head-to-head games between two franchises. The franchise with more wins is listed first."
  ),
  rec(
    "rivalry.lopsided",
    "Most lopsided head-to-head",
    rivalryBase({ qualifier: { minGames: 6 } }),
    "winPct",
    "desc",
    rivalryCols,
    "The highest win % in a head-to-head series, with at least six games."
  ),
  rec(
    "rivalry.streak",
    "Longest head-to-head win streak",
    rivalryBase(),
    "streak",
    "desc",
    [
      c("team", "Team / Manager", "team"),
      c("opponent", "Opponent", "opponent"),
      c("streak", "Wins in a row", "int"),
      c("span", "From / to", "text"),
    ],
    "Consecutive wins by one franchise over another. A tie ends a streak."
  ),
];

// ---- Manager (franchise career) ---------------------------------------------------------------------------------
const careerBase = (section: string, engine: string, extra: Partial<Base> = {}): Base => ({
  category: "manager",
  section,
  grain: "franchise_career",
  engine,
  filters: CAREER_FILTERS,
  displayAll: true,
  ...extra,
});
const regretCols = [
  MANAGER,
  c("count", "Games", "int"),
  c("losses", "Losses", "int"),
  c("pct", "Share of losses", "pct"),
];
const marginCols = [
  MANAGER,
  c("wins", "Wins", "int"),
  c("losses", "Losses", "int"),
  c("games", "Games", "int"),
  c("winPct", "Win %", "pct"),
];
const careerLuck: RecordDef[] = [
  rec(
    "career.shouldve-won",
    "Most should've-won losses",
    careerBase("Luck and Regret", "careerRegret", { requires: req("playerData") }),
    "count",
    "desc",
    regretCols,
    "Losses that the optimal lineup would have won."
  ),
  rec(
    "career.contender",
    "Most coulda-been-a-contender eliminations",
    careerBase("Luck and Regret", "careerRegret", {
      requires: req("playerData"),
      filters: ["seasons"],
    }),
    "count",
    "desc",
    regretCols,
    "Playoff eliminations that a perfect lineup would have survived."
  ),
  rec(
    "career.blunders",
    "Most bye-week blunders that cost a game",
    careerBase("NFL Byes and Inactives", "careerRegret", { requires: req("playerData") }),
    "count",
    "desc",
    regretCols,
    "Losses that swapping the bye or inactive starters for bench players would have won."
  ),
  rec(
    "career.close.wins",
    "Most close-game wins",
    careerBase("Close Games and Blowouts", "careerMargins"),
    "wins",
    "desc",
    marginCols,
    "Games decided by fewer than 5 points."
  ),
  rec(
    "career.close.losses",
    "Most close-game losses",
    careerBase("Close Games and Blowouts", "careerMargins"),
    "losses",
    "desc",
    marginCols,
    "Games decided by fewer than 5 points."
  ),
  rec(
    "career.blowout.wins",
    "Most blowout wins",
    careerBase("Close Games and Blowouts", "careerMargins"),
    "wins",
    "desc",
    marginCols,
    "Games decided by more than 50 points."
  ),
  rec(
    "career.blowout.losses",
    "Most blowout losses",
    careerBase("Close Games and Blowouts", "careerMargins"),
    "losses",
    "desc",
    marginCols,
    "Games decided by more than 50 points."
  ),
];
const weeklyCareerCols = [
  MANAGER,
  c("count", "Weeks", "int"),
  c("weeks", "Of", "int"),
  c("pct", "Share", "pct"),
];
const careerWeekly: RecordDef[] = [
  rec(
    "career.top-scorer",
    "Most weeks as the top scorer",
    careerBase("Weekly Highs and Lows", "careerWeekly"),
    "count",
    "desc",
    weeklyCareerCols,
    "Weeks with the league's highest score."
  ),
  rec(
    "career.bottom-scorer",
    "Most weeks as the lowest scorer",
    careerBase("Weekly Highs and Lows", "careerWeekly"),
    "count",
    "desc",
    weeklyCareerCols,
    "Weeks with the league's lowest score."
  ),
  rec(
    "career.asleep",
    "Most starters on a bye or inactive",
    careerBase("NFL Byes and Inactives", "careerWeekly", { requires: req("playerData") }),
    "count",
    "desc",
    [
      MANAGER,
      c("count", "Starters out", "int"),
      c("byeStarters", "Bye", "int"),
      c("pointsLost", "Points lost", "points"),
      c("weeks", "Weeks", "int"),
    ],
    "Starters whose NFL team was on a bye or who were not active, over a career."
  ),
];
const runCols = [
  MANAGER,
  c("run", "Seasons", "int"),
  c("span", "From / to", "text"),
  c("total", "Of", "int"),
];
const careerRuns: RecordDef[] = [
  rec(
    "drought.title",
    "Longest title drought",
    careerBase("Droughts and Dynasties", "careerRuns", { filters: ["seasons"] }),
    "run",
    "desc",
    runCols,
    "Consecutive completed seasons without winning the title, including one still going."
  ),
  rec(
    "streak.playoffs",
    "Most consecutive playoff appearances",
    careerBase("Droughts and Dynasties", "careerRuns", { filters: ["seasons"] }),
    "run",
    "desc",
    runCols
  ),
  rec(
    "streak.toilet-bowl",
    "Most consecutive toilet bowl appearances",
    careerBase("Droughts and Dynasties", "careerRuns", { filters: ["seasons"] }),
    "run",
    "desc",
    runCols
  ),
];

// ---- Power rankings ---------------------------------------------------------------------------------------------
const powerCols = [
  MANAGER,
  c("rating", "Power Rating", "int"),
  c("winChance", "Win % vs Average", "pct"),
  c("games", "Games", "int"),
  c("seasons", "Seasons", "int"),
  c("missed", "Missed Seasons", "int"),
];
const powerRankings: RecordDef[] = [
  rec(
    "career.power",
    "Power rating",
    careerBase("Power Rankings", "careerPower", { filters: ["seasons"], active: "flag" }),
    "rating",
    "desc",
    powerCols,
    "An Elo rating built from every head-to-head game (regular season, playoffs and toilet bowl): everyone starts at 1500, each game moves the rating by up to 32 points times a margin factor (a blowout counts more than a squeaker, a favourite winning big counts less), and beating a stronger manager is worth more. Each season a manager sits out fades the rating 25% of the way toward 1400, so missing seasons always costs rating. Seasons still in progress are included and flagged."
  ),
];

export const EXTRA_RECORDS: readonly RecordDef[] = [
  ...luckAndRegret,
  ...projections,
  ...playerProjections,
  ...gameOther,
  ...nflReference,
  ...allplay,
  ...schedule,
  ...weeklyCounts,
  ...seedFinish,
  ...trajectory,
  ...draftClasses,
  ...pickups,
  ...trades,
  ...tenureRecords,
  ...drafts,
  ...rivalries,
  ...careerLuck,
  ...careerWeekly,
  ...careerRuns,
  ...powerRankings,
];
