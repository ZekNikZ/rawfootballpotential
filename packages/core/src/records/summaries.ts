// One-line summaries (about 60 characters) shown under each record's name in the record picker. The longer
// description sits under the picker once a record is chosen. The test in records.test.ts requires one per record.
export const RECORD_SUMMARIES: Readonly<Record<string, string>> = {
  // Matchup Scores
  "score.high": "Best and worst single-week team scores",
  blowout: "Biggest blowouts and narrowest wins",
  "loss.high-score": "Highest scores that still lost",
  "win.low-score": "Lowest scores that still won",
  "uncounted.best": "Top scores from byes and games outside the brackets",
  "oneman.high": "Highest share of starter points from one player",
  "era.score": "Scores in standard deviations above the week's average",

  // Teamwide Matchup Scores
  "teamwide.high": "Whole-roster points in a week, starters plus bench",
  "bench.high": "Points left on the bench in a week",

  // Lineup Efficiency
  "potential.high": "Points of the best lineup a roster could have started",
  "actual.high": "Points the starting lineup actually scored",
  "ratio.high": "Share of potential points a lineup realized",

  // Player Scores
  "player.roster.high": "Best and worst weeks by any rostered player",
  "player.starter.high": "Best and worst weeks by a starter",
  "player.bench.high": "Best and worst weeks by a benched player",
  "bench-season.player": "Most points scored while on a team's bench in a season",

  // Luck & Misses
  "luck.unluckiest-loss": "Losses despite one of the week's top scores",
  "luck.luckiest-win": "Wins despite one of the week's lowest scores",
  "shouldve-won": "Losses the optimal lineup would have won",
  "contender.eliminated": "Playoff exits a perfect lineup would have survived",
  "median.won-h2h-lost": "Won the game but finished below the weekly median",
  "median.lost-h2h-won": "Lost the game but finished above the weekly median",
  "heartbreak.playoff-loss": "Playoff games lost by the smallest margin",

  // Projections
  "projection.boom": "Team scores far above or below projection",
  "projection.upset": "Wins despite the largest projected deficit",
  "projection.player.boom": "Starters far above or below projection",

  // Byes & Inactives
  "asleep.week": "Most starters on a bye or inactive in one week",
  "asleep.lost-week": "Points the best live bench would have added",
  "asleep.blunder": "Losses a bench swap for dead starters would have won",
  "bye.survivor": "Best scores with two or more starters on a bye",
  "bye.heaviest": "Most starters on a bye in a game still won",
  "nfl.stack": "Most starter points from one NFL game",

  // Waivers & Trades
  "waiver.faab-high": "Biggest FAAB bids on a successful claim",
  "trade.largest": "Trades that moved the most players",
  "trade.broadest": "Trades involving the most teams",
  "pickup.best": "Waiver pickups with the most starter points",
  "pickup.value": "Starter points per FAAB dollar on winning bids",
  "pickup.faab-per-point": "Most FAAB spent per starter point",
  "drop-regret": "Dropped players who scored most as starters elsewhere",
  "trade.best": "Starter points gained by one side of a trade",
  "trade.lopsided": "Biggest starter-point gap between a trade's sides",

  // Player Tenures
  "moves.player": "Players involved in the most transactions",
  "journeyman.career": "Players who suited up for the most franchises",
  "journeyman.season": "Players on the most teams in a single season",
  "loyalty.stint": "Longest stints with one franchise",
  "boomerang.longest": "Players who left a franchise and came back latest",

  // Draft Results
  "draft.price-high": "Highest auction prices paid in a draft",
  "draft.steal": "Picks that beat or missed their draft slot most",
  "draft.best-by-round": "The top scorer picked in each round",
  "auction.value": "Most season points per auction dollar",
  "auction.bust": "Most auction dollars per season point",
  "draft.class.best": "Best and worst drafts by starter points",
  "season.retention.high": "Share of drafted players still rostered at season's end",

  // Rivalries
  "rivalry.most-played": "Pairings that have met the most times",
  "rivalry.lopsided": "Highest win % in a head-to-head series (6+ games)",
  "rivalry.streak": "Longest head-to-head win streaks",

  // Team Seasons
  "season.pf.high": "Most and fewest points scored in a season",
  "season.pa.high": "Most and fewest points against in a season",
  "season.wins.high": "Most wins by a team in a season",
  "season.losses.high": "Most losses by a team in a season",
  "season.winpct.high": "Best and worst win percentages in a season",
  "season.iq.high": "Best and worst lineup IQ in a season",
  "season.player.high": "Highest scoring player seasons",

  // Transactions (single season)
  "season.trades.most": "Most and fewest trades by a team in a season",
  "season.claims.most": "Most and fewest waiver claims in a season",
  "season.faab.most": "Most and least FAAB spent in a season",

  // Luck & Schedule
  "season.allplay.high": "Win % if every team played every other every week",
  "season.luck.high": "Actual wins above or below all-play expectation",
  "season.schedule.best": "Best and worst records against other teams' schedules",

  // Weekly Highs & Lows
  "season.top-scorer": "Most weeks as the league's top scorer",
  "season.bottom-scorer": "Most weeks as the league's lowest scorer",

  // Seeds & Finishes
  "seed.lowest-champion": "Lowest regular-season seeds that won the title",
  "seed.top-worst": "Top seeds with the worst final finish",
  "seed.worst-record-playoffs": "Worst records that still made the playoffs",
  "seed.best-record-missed": "Best records that missed the playoffs",
  "champ.worst": "Champions with the fewest regular-season points",
  "champ.best-non": "Highest-scoring non-champions",
  "trajectory.weeks-first": "Most weeks in first place without the title",
  "trajectory.fall": "Worst finish by the team in first after the regular season",

  // Standings (managers)
  "career.wins": "Career wins",
  "career.losses": "Career losses",
  "career.years": "Seasons played in the league",
  "career.winpct": "Career win percentage (minimum games)",
  "career.win-streak": "Longest win streaks within a season",
  "career.loss-streak": "Longest loss streaks within a season",

  // Placements
  "career.place.avg": "Average finish, scaled to league size",
  "career.place.best": "Best final finish",
  "career.place.worst": "Worst final finish",
  "career.playoffs": "Playoff appearances",
  "career.toilet-bowls": "Toilet bowl appearances",

  // Lineup IQ
  "career.perfect": "Weeks the lineup matched the best possible lineup",
  "career.missed": "Fewest points left on the bench across a career",
  "career.iq": "Career lineup IQ",

  // Scoring
  "career.score.high": "Best single-week score by a manager",
  "career.score.low": "Worst single-week score by a manager",
  "career.pf": "Career points scored",
  "career.pa": "Career points against",
  "career.pfpg": "Average points scored per game",
  "career.papg": "Average points against per game",

  // Transactions (managers)
  "career.trades": "Career trades",
  "career.claims": "Career waiver claims",
  "career.spent": "Career FAAB spent",

  // Luck & Misses (managers)
  "career.shouldve-won": "Losses a better lineup would have won",
  "career.contender": "Playoff exits a perfect lineup would have survived",

  // Byes & Inactives (managers)
  "career.blunders": "Bye-week mistakes that cost a game",
  "career.asleep": "Starters on a bye or inactive, over a career",

  // Close Games & Blowouts
  "career.close.wins": "Wins by fewer than 5 points",
  "career.close.losses": "Losses by fewer than 5 points",
  "career.blowout.wins": "Wins by more than 50 points",
  "career.blowout.losses": "Losses by more than 50 points",

  // Weekly Highs & Lows (managers)
  "career.top-scorer": "Weeks as the league's top scorer",
  "career.bottom-scorer": "Weeks as the league's lowest scorer",

  // Droughts & Dynasties
  "drought.title": "Longest stretch of seasons without a title",
  "streak.playoffs": "Longest runs of playoff appearances",
  "streak.toilet-bowl": "Longest runs of toilet bowl appearances",

  // Point Differentials
  "career.diff.avg": "Average margin across all games",
  "career.diff.min": "Worst single-game margin",
  "career.diff.max": "Best single-game margin",
  "career.diff.stddev": "Most volatile game-to-game margins",

  // Power Rankings
  "career.power": "Elo-style rating from every game played",
};
