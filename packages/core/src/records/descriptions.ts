// One-line descriptions (shown under the record picker) for the records whose definition is not spelled out where they
// are declared. Records declared with their own description (catalog-extra.ts and a few in catalog.ts) win over these.
// The test in records.test.ts requires every record to end up with one.
export const RECORD_DESCRIPTIONS: Readonly<Record<string, string>> = {
  // Single Week Scores
  "score.high":
    "Single-week team scores. Ranked highest first; click the Score header to rank lowest first.",
  blowout:
    "Margins of victory in a single game. Ranked largest first; click the Score header to rank the narrowest wins first.",
  "loss.high-score": "The highest scores that still lost the game. Ranked by points scored.",
  "win.low-score": "The lowest scores that still won the game. Ranked by fewest points scored.",

  // Single Week Teamwide Scores
  "teamwide.high":
    "The combined score of a team's whole roster in a week: starters plus bench. Ranked highest first; click the header to flip it.",
  "bench.high":
    "The points scored by a team's bench in a single week. Ranked highest first; click the header to flip it.",

  // Single Week Potential Score
  "potential.high":
    "The potential score in a week: the points of the best lineup the roster could have started. Ranked highest first; click the header to flip it.",
  "actual.high":
    "The points the starting lineup actually scored in a week, shown with the potential score and the share realized. Ranked highest first; click the header to flip it.",
  "ratio.high":
    "The share of potential points realized in a week: points scored divided by the best possible lineup's points. Ranked highest first; click the header to flip it.",

  // Player Performances
  "player.roster.high":
    "Single-week scores by any player on a roster, starting or on the bench. Ranked highest first; zero-point weeks are left out by default.",
  "player.starter.high":
    "Single-week scores by a player in a starting lineup slot. Ranked highest first; zero-point weeks are left out by default.",
  "player.bench.high":
    "Single-week scores by a player left on the bench (a player on IR counts as bench). Ranked highest first; zero-point weeks are left out by default.",

  // Transactions
  "waiver.faab-high":
    "The most auction (FAAB) dollars spent on a single successful waiver claim. Failed claims do not count.",
  "draft.price-high":
    "The most auction dollars spent on a single draft pick (auction drafts only).",
  "moves.player":
    "The players involved in the most executed transactions (trades, waiver claims, free-agent adds and drops) across the seasons shown.",
  "trade.largest":
    "The trades that moved the most players in total, shown with the picks and FAAB included. Ranked by players moved.",
  "trade.broadest": "The trades that involved the most teams. Ranked by the number of teams.",

  // Other
  "bench-season.player":
    "The players who scored the most points for a team in a season while sitting on its bench (IR counts as bench). Ranked by bench points.",
  "uncounted.best":
    "The highest scores that did not count toward a game: weeks with no opponent or outside the playoff brackets.",

  // Single Season
  "season.pf.high":
    "Points scored by a team in a season (PF). Ranked most first; click the PF header for the fewest (completed seasons only).",
  "season.pa.high":
    "Points scored against a team in a season (PA). Ranked most first; click the PA header for the fewest (completed seasons only).",
  "season.wins.high": "The most wins by a team in a season.",
  "season.losses.high": "The most losses by a team in a season.",
  "season.winpct.high":
    "Win percentage by a team in a season; ties count as half a win. Ranked highest first; click the header for the lowest.",
  "season.iq.high":
    "Lineup IQ in a season: points scored divided by the points of the best possible lineups each week. Ranked highest first; click the header for the lowest.",
  "season.player.high":
    "The most points scored by one player in a season while on a team, shown with points per game and the best and worst weeks.",

  // Single Season Transactions
  "season.trades.most":
    "Trades completed by a team in a season. Ranked most first; click the Trades header for the fewest, including none (completed seasons only).",
  "season.claims.most":
    "Successful waiver claims by a team in a season. Ranked most first; click the header for the fewest, including none (completed seasons only).",
  "season.faab.most":
    "Auction (FAAB) dollars spent on waiver claims by a team in a season. Ranked most first; click the header for the fewest (completed seasons only).",
  "season.retention.high":
    "The share of a team's drafted players still on its roster at the end of the season. Ranked highest first; click the header for the lowest.",

  // Career Standings
  "career.wins": "Total wins across a manager's career, for the selected time scope.",
  "career.losses": "Total losses across a manager's career, for the selected time scope.",
  "career.years": "The number of seasons a manager has been in the league (YiL).",
  "career.winpct": "Career win percentage. Ties count as half a win.",
  "career.win-streak":
    "The longest winning streak a manager has had within a single season (streaks do not carry across seasons).",
  "career.loss-streak":
    "The longest losing streak a manager has had within a single season (streaks do not carry across seasons).",

  // Career Placements
  "career.place.avg":
    "Placement weighted by league size: each completed season counts as (teams - place) / (teams - 1), so a champion is 100% and last place is 0%, and a 2nd of 14 beats a 2nd of 9. Ranked by the average over the seasons played.",
  "career.place.best":
    "The best final placement a manager has ever finished with. Lower is better.",
  "career.place.worst": "The worst final placement a manager has ever finished with.",
  "career.playoffs": "The number of seasons a manager made the playoffs.",
  "career.toilet-bowls": "The number of seasons a manager played in the toilet bowl.",

  // Career Lineup IQ
  "career.perfect":
    "The number of weeks a manager's starting lineup scored exactly as many points as the best possible lineup.",
  "career.missed":
    "The fewest total points left on the bench across a career: best-possible lineup points minus points actually scored.",
  "career.iq":
    "Career lineup IQ: total points scored divided by the total points of the best possible lineups each week.",

  // Career Scores
  "career.score.high": "The highest single-week score a manager has ever had.",
  "career.score.low":
    "The lowest single-week score a manager has ever had; the lowest of the lows ranks first.",
  "career.pf": "Total points scored across a manager's career (PF).",
  "career.pa": "Total points scored against a manager's teams across their career (PA).",
  "career.pfpg": "Average points scored per game across a manager's career (PFPG).",
  "career.papg": "Average points scored against per game across a manager's career (PAPG).",

  // Career Transactions
  "career.trades": "The total number of trades a manager has made.",
  "career.claims": "The total number of successful waiver claims a manager has made.",
  "career.spent": "The total auction (FAAB) dollars a manager has spent on waiver claims.",

  // Seeds and Finishes
  "seed.lowest-champion":
    "The champions with the lowest regular-season seed. Ranked by seed, lowest first.",
  "seed.top-worst":
    "The worst final finishes by a team that earned a top regular-season seed. Ranked by final placement.",
  "seed.worst-record-playoffs":
    "The worst regular-season records that still made the playoffs. Ranked by win percentage, lowest first.",
  "seed.best-record-missed":
    "The best regular-season records that missed the playoffs. Ranked by win percentage, highest first.",

  // Droughts and Dynasties
  "streak.playoffs": "The most consecutive seasons a manager made the playoffs.",
  "streak.toilet-bowl": "The most consecutive seasons a manager played in the toilet bowl.",
};
