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
    gameBase("Luck & Misses"),
    "rankText",
    "asc",
    luckCols,
    "A loss with one of the week's highest scores. Ranked by weekly score rank, then by score."
  ),
  rec(
    "luck.luckiest-win",
    "Luckiest win",
    gameBase("Luck & Misses"),
    "rankText",
    "desc",
    luckCols,
    "A win with one of the week's lowest scores. Ranked by weekly score rank, then by lowest score."
  ),
  rec(
    "shouldve-won",
    "Should've won",
    gameBase("Luck & Misses", { requires: req("playerData") }),
    "left",
    "desc",
    leftCols,
    "Losses that the optimal lineup would have won, ranked by points left on the bench."
  ),
  rec(
    "contender.eliminated",
    "Coulda been a contender",
    gameBase("Luck & Misses", {
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
    gameBase("Luck & Misses"),
    "gap",
    "asc",
    [TEAM, WEEK, OPPONENT, SCORE, c("median", "Median", "points"), c("gap", "Vs median", "points")],
    "Won the head-to-head but finished below the week's median (median leagues). Ranked by the gap to the median."
  ),
  rec(
    "median.lost-h2h-won",
    "Lost the game, won the median",
    gameBase("Luck & Misses"),
    "gap",
    "desc",
    [TEAM, WEEK, OPPONENT, SCORE, c("median", "Median", "points"), c("gap", "Vs median", "points")],
    "Lost the head-to-head but finished above the week's median (median leagues). Ranked by the gap to the median."
  ),
  rec(
    "heartbreak.playoff-loss",
    "Closest playoff loss",
    gameBase("Luck & Misses", {
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
    "Team score vs. projection",
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
    "Team score above (boom) or below (bust) the starters' projections. Ranked by the difference, biggest boom first."
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

const playerProjection = (id: string, title: string, text: string) =>
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
    "desc",
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
    "Player score vs. projection",
    "A starter's points above (boom) or below (bust) his projection. Ranked by the difference, biggest boom first. Starters who were on a bye or inactive are left out."
  ),
];

const gameOther: RecordDef[] = [
  rec(
    "oneman.high",
    "One-man show",
    gameBase("Matchup Scores", { requires: req("playerData") }),
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
    gameBase("Matchup Scores"),
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
  gameBase("Byes & Inactives", { requires: req("playerData"), ...extra });
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
      section: "Byes & Inactives",
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
    seasonBase("Luck & Schedule", "allPlay", {
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
    "Luck in a season",
    seasonBase("Luck & Schedule", "allPlay", {
      active: "flag",
      activeReverse: "complete_only",
      qualifier: { minGames: 8 },
      preset: { scope: "regular" },
      filters: ["seasons", "franchise", "onePer", "minGames"],
    }),
    "luck",
    "desc",
    seasonLuckCols,
    "Actual wins minus the wins the all-play record predicts. Ranked luckiest first; sort the other way for the unluckiest."
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
    "Record with every other schedule",
    seasonBase("Luck & Schedule", "scheduleSwap", {
      active: "complete_only",
      filters: ["seasons", "franchise", "onePer"],
    }),
    "winPct",
    "desc",
    scheduleCols,
    "Your regular-season scores against each other team's schedule. Games where that schedule faced you are skipped. Ranked best possible record first; sort the other way for the worst."
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
    seasonBase("Weekly Highs & Lows", "weeklyCounts", { active: "flag" }),
    "count",
    "desc",
    weeklyCols,
    "Weeks with the league's highest score."
  ),
  rec(
    "season.bottom-scorer",
    "Most weeks as the lowest scorer",
    seasonBase("Weekly Highs & Lows", "weeklyCounts", { active: "flag" }),
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
    seasonBase("Seeds & Finishes", "seedFinish", {
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
    seasonBase("Seeds & Finishes", "seedFinish", {
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
    seasonBase("Seeds & Finishes", "seedFinish", {
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
    seasonBase("Seeds & Finishes", "seedFinish", {
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
    seasonBase("Seeds & Finishes", "seedFinish", {
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
    seasonBase("Seeds & Finishes", "seedFinish", {
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
    seasonBase("Seeds & Finishes", "trajectory", {
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
    seasonBase("Seeds & Finishes", "trajectory", {
      active: "complete_only",
      filters: ["seasons", "weeks", "franchise", "onePer"],
    }),
    "finalPlace",
    "desc",
    trajectoryCols,
    "The worst finish by a team that was in first place after the last regular-season week (or after any week in the weeks filter)."
  ),
];

const draftClass = (id: string, title: string) =>
  rec(
    id,
    title,
    seasonBase("Draft Results", "draftClass", {
      active: "flag",
      activeReverse: "complete_only",
      filters: ["seasons", "scope", "franchise", "onePer"],
      requires: req("playerData", "draft"),
    }),
    "classPoints",
    "desc",
    [
      TEAM,
      SEASON,
      c("classPoints", "Starter points", "points"),
      c("picks", "Picks", "int"),
      c("starters", "Started", "int"),
      c("bestPick", "Best pick", "text"),
    ],
    "Starter points the team got from the players it drafted that season, while it rostered them. Ranked best class first; sort the other way for the worst."
  );
const draftClasses: RecordDef[] = [draftClass("draft.class.best", "Draft class")];

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
    pickupBase("Waivers & Trades", { version: 2 }),
    "starterPoints",
    "desc",
    pickupCols,
    "Points a claimed player scored as a starter for the team that claimed him, until it let him go."
  ),
  rec(
    "pickup.value",
    "Best value pickup",
    pickupBase("Waivers & Trades", {
      requires: req("transactions", "playerData", "faab"),
      version: 2,
    }),
    "pointsPerDollar",
    "desc",
    [...pickupCols, c("pointsPerDollar", "Points per $", "decimal")],
    "Starter points per FAAB dollar, for winning bids of at least $1."
  ),
  rec(
    "pickup.faab-per-point",
    "Most FAAB per point",
    pickupBase("Waivers & Trades", {
      requires: req("transactions", "playerData", "faab"),
      version: 2,
    }),
    "dollarsPerPoint",
    "desc",
    [...pickupCols, c("dollarsPerPoint", "$ per point", "decimal")],
    "FAAB dollars per starter point. A claim that scored under one point counts as one."
  ),
  rec(
    "drop-regret",
    "Drop regret",
    pickupBase("Waivers & Trades", { grain: "player_season", engine: "dropRegret" }),
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
  c("partners", "Traded with", "teams"),
  c("got", "Got", "text"),
  c("gave", "Gave", "text"),
  c("sidePoints", "Starter points", "points"),
  c("otherPoints", "Other side", "points"),
  c("difference", "Difference", "points"),
];
const tradeEstCols = tradeCols.map((col) =>
  col.key === "sidePoints" ? { ...col, title: "Estimated value" } : col
);
const trades: RecordDef[] = [
  rec(
    "trade.best",
    "Best trade",
    pickupBase("Waivers & Trades", { grain: "transaction", engine: "tradeValue", version: 2 }),
    "sidePoints",
    "desc",
    tradeCols,
    "Starter points the players one side received scored for it over the rest of the season."
  ),
  rec(
    "trade.lopsided",
    "Most lopsided trade",
    pickupBase("Waivers & Trades", { grain: "transaction", engine: "tradeValue", version: 2 }),
    "difference",
    "desc",
    tradeCols,
    "The gap between the winning side's starter points and the other side's, for trades where each side received players."
  ),
  rec(
    "trade.best.est",
    "Best trade (estimated value)",
    pickupBase("Waivers & Trades", {
      grain: "transaction",
      engine: "tradeValue",
      readsAllSeasons: true,
      version: 4,
    }),
    "sidePoints",
    "desc",
    tradeEstCols,
    "Estimated value one side got from a trade: the points its players scored from the trade to the end of that season wherever they were (what the team did with them afterward does not change it), a dynasty player's next season at half, and draft picks as the player they became."
  ),
  rec(
    "trade.lopsided.est",
    "Most lopsided trade (estimated value)",
    pickupBase("Waivers & Trades", {
      grain: "transaction",
      engine: "tradeValue",
      readsAllSeasons: true,
      version: 4,
    }),
    "difference",
    "desc",
    tradeEstCols,
    "The gap between the winning side's estimated trade value and the other side's (rest-of-season points wherever the players were, picks, and a dynasty player's next season at half), for trades where each side received something."
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
      section: "Player Tenures",
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
      section: "Player Tenures",
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
      section: "Player Tenures",
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
      section: "Player Tenures",
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
    "Draft steals and busts",
    {
      category: "overall",
      section: "Draft Results",
      grain: "draft_pick",
      engine: "draftValue",
      filters: ["seasons", "franchise", "positions", "onePer"],
      positionOptions: ["QB", "RB", "WR", "TE"],
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
    "Picks that outscored (steal) or underperformed (bust) their draft slot, among QB, RB, WR and TE drafted in the same draft (with a position selected, ranked only against that position's picks). Ranked by places gained, biggest steal first."
  ),
  rec(
    "draft.best-by-round",
    "Best pick of each round",
    {
      category: "overall",
      section: "Draft Results",
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
      section: "Draft Results",
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
      section: "Draft Results",
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
const tradeValueCols = [
  MANAGER,
  c("trades", "Trades", "int"),
  c("record", "Won-lost", "text"),
  c("gained", "Points gained", "points"),
  c("lost", "Points lost", "points"),
  c("net", "Net points", "points"),
  c("netPerTrade", "Net per trade", "points"),
];
const tradeValueBase = careerBase("Transactions", "careerTradeValue", {
  filters: ["seasons", "scope"],
  requires: req("transactions", "playerData"),
  version: 4,
  readsAllSeasons: true,
});
const careerTradeValue: RecordDef[] = [
  rec(
    "career.trade-value.total",
    "Best overall trade value",
    tradeValueBase,
    "net",
    "desc",
    tradeValueCols,
    "Net points a manager's trades produced: the points the players received scored from the trade to the end of that season wherever they were (a flip or drop does not change it), a dynasty player's next season at half, and draft picks as the player they became, minus the same for what they sent away. FAAB is not valued. A trade is won when its net is above zero."
  ),
  rec(
    "career.trade-value.avg",
    "Best average trade value",
    {
      ...tradeValueBase,
      filters: ["seasons", "scope", "minGames"],
      qualifier: { minGames: 3 },
    },
    "netPerTrade",
    "desc",
    tradeValueCols,
    "Net points per trade (same measure as overall trade value), for managers with at least 3 trades. The minimum can be changed."
  ),
];
const careerLuck: RecordDef[] = [
  rec(
    "career.shouldve-won",
    "Most should've-won losses",
    careerBase("Luck & Misses", "careerRegret", { requires: req("playerData") }),
    "count",
    "desc",
    regretCols,
    "Losses that the optimal lineup would have won."
  ),
  rec(
    "career.contender",
    "Most coulda-been-a-contender eliminations",
    careerBase("Luck & Misses", "careerRegret", {
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
    careerBase("Byes & Inactives", "careerRegret", { requires: req("playerData") }),
    "count",
    "desc",
    regretCols,
    "Losses that swapping the bye or inactive starters for bench players would have won."
  ),
  rec(
    "career.close.wins",
    "Most close-game wins",
    careerBase("Close Games & Blowouts", "careerMargins"),
    "wins",
    "desc",
    marginCols,
    "Games decided by fewer than 5 points."
  ),
  rec(
    "career.close.losses",
    "Most close-game losses",
    careerBase("Close Games & Blowouts", "careerMargins"),
    "losses",
    "desc",
    marginCols,
    "Games decided by fewer than 5 points."
  ),
  rec(
    "career.blowout.wins",
    "Most blowout wins",
    careerBase("Close Games & Blowouts", "careerMargins"),
    "wins",
    "desc",
    marginCols,
    "Games decided by more than 50 points."
  ),
  rec(
    "career.blowout.losses",
    "Most blowout losses",
    careerBase("Close Games & Blowouts", "careerMargins"),
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
    careerBase("Weekly Highs & Lows", "careerWeekly"),
    "count",
    "desc",
    weeklyCareerCols,
    "Weeks with the league's highest score."
  ),
  rec(
    "career.bottom-scorer",
    "Most weeks as the lowest scorer",
    careerBase("Weekly Highs & Lows", "careerWeekly"),
    "count",
    "desc",
    weeklyCareerCols,
    "Weeks with the league's lowest score."
  ),
  rec(
    "career.asleep",
    "Most starters on a bye or inactive",
    careerBase("Byes & Inactives", "careerWeekly", { requires: req("playerData") }),
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
    careerBase("Droughts & Dynasties", "careerRuns", { filters: ["seasons"] }),
    "run",
    "desc",
    runCols,
    "Consecutive completed seasons without winning the title, including one still going."
  ),
  rec(
    "streak.playoffs",
    "Most consecutive playoff appearances",
    careerBase("Droughts & Dynasties", "careerRuns", { filters: ["seasons"] }),
    "run",
    "desc",
    runCols
  ),
  rec(
    "streak.toilet-bowl",
    "Most consecutive toilet bowl appearances",
    careerBase("Droughts & Dynasties", "careerRuns", { filters: ["seasons"] }),
    "run",
    "desc",
    runCols
  ),
];

const diffCols = [
  MANAGER,
  c("avg", "Average", "points"),
  c("min", "Worst", "points"),
  c("max", "Best", "points"),
  c("stddev", "Std dev", "points"),
  c("games", "Games", "int"),
];
const careerDifferentials: RecordDef[] = [
  rec(
    "career.diff.avg",
    "Highest average point differential",
    careerBase("Point Differentials", "careerDifferential"),
    "avg",
    "desc",
    diffCols,
    "Average of points scored minus points allowed over a manager's head-to-head games (positive means they usually outscore their opponents). Two-week games and median games are not counted."
  ),
  rec(
    "career.diff.min",
    "Worst single-game point differential",
    careerBase("Point Differentials", "careerDifferential"),
    "min",
    "asc",
    diffCols,
    "The most lopsided loss: the lowest points scored minus points allowed in any one head-to-head game. Two-week games and median games are not counted."
  ),
  rec(
    "career.diff.max",
    "Best single-game point differential",
    careerBase("Point Differentials", "careerDifferential"),
    "max",
    "desc",
    diffCols,
    "The most lopsided win: the highest points scored minus points allowed in any one head-to-head game. Two-week games and median games are not counted."
  ),
  rec(
    "career.diff.stddev",
    "Most volatile point differential",
    careerBase("Point Differentials", "careerDifferential"),
    "stddev",
    "desc",
    diffCols,
    "Standard deviation of a manager's point differential across head-to-head games: high means results swing between blowouts and close games, low means steady margins. Needs at least two games. Two-week games and median games are not counted."
  ),
];

// ---- Power rankings ---------------------------------------------------------------------------------------------
const powerCols = [
  MANAGER,
  c("rating", "Power Rating", "int"),
  c("winPct", "Win %", "pct"),
  c("placePct", "Weighted Placement", "pct"),
  c("games", "Games", "int"),
  c("seasons", "Seasons", "int"),
  c("missed", "Missed Seasons", "int"),
];
const powerRankings: RecordDef[] = [
  rec(
    "career.power",
    "Power rating",
    careerBase("Power Rankings", "careerPower", {
      filters: ["seasons"],
      active: "flag",
      version: 2,
      readsAllSeasons: true,
    }),
    "rating",
    "desc",
    powerCols,
    "A rating built from every head-to-head game (regular season, playoffs and toilet bowl) and every week's median score. It starts as an Elo: each game moves a rating by up to 32 points, more for a bigger margin (half as much weight on the margin as on the result), more when the underdog wins, and beating a stronger manager is worth more. Playoff wins and toilet-bowl losses count 1.5x, and medians count at half weight in every season. Each season a manager sits out fades the rating a quarter of the way toward a floor. The Elo is then adjusted for consistency (uneven season-to-season margins cost points for managers with 3+ seasons) and for final placements (each completed season adds or subtracts points for how it finished, scaled to league size, 1.5x), blended 75/25 with the career average weighted placement, and shown on a scale where the league average is 1500 and each standard deviation is 250 points, measured on the league's full history so a Seasons filter does not stretch it. Seasons still in progress are included and flagged."
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
  ...careerTradeValue,
  ...careerWeekly,
  ...careerRuns,
  ...careerDifferentials,
  ...powerRankings,
];
