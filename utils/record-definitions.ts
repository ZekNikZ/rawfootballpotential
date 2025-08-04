import formatter from "format-number";
import {
  BaseRecordEntry,
  FantasyRecord,
  League,
  LeagueDefinition,
  LeagueId,
  ManagerId,
  NFLData,
  RecordCategoryDefinition,
  RecordDefinition,
  RecordScope,
  Team,
} from "../types";
import _ from "lodash";
import { optimizeScore } from "./positions";

const twoDecimalFormat = formatter({ round: 2, padRight: 2 });

export const RECORD_DEFINITIONS: (RecordDefinition | RecordCategoryDefinition)[] = [
  {
    type: "category",
    category: "overall",
    name: "Single Week Scores",
    children: [
      {
        type: "record",
        category: "overall",
        name: "Highest score",
        generateRecord: weeklyScoreRecord("score", "highest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Lowest score",
        generateRecord: weeklyScoreRecord("score", "lowest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Largest blowout",
        generateRecord: weeklyScoreRecord("differential", "highest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Narrowest win",
        generateRecord: weeklyScoreRecord("differential", "lowest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Highest scoring loss",
        generateRecord: weeklyScoreRecord("loserScore", "highest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Lowest scoring win",
        generateRecord: weeklyScoreRecord("winnerScore", "lowest"),
      },
    ],
  },
  {
    type: "category",
    category: "overall",
    name: "Single Week Teamwide Scores",
    children: [
      {
        type: "record",
        category: "overall",
        name: "Highest teamwide score",
        generateRecord: weeklyTeamwideScoreRecord("total", "highest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Lowest teamwide score",
        generateRecord: weeklyTeamwideScoreRecord("total", "lowest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Highest bench score",
        generateRecord: weeklyTeamwideScoreRecord("bench", "highest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Lowest bench score",
        generateRecord: weeklyTeamwideScoreRecord("bench", "lowest"),
      },
    ],
  },
  {
    type: "category",
    category: "overall",
    name: "Single Week Potential Score",
    children: [
      {
        type: "record",
        category: "overall",
        name: "Highest potential points",
        generateRecord: weeklyPotentialScoreRecord("score", "highest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Lowest potential points",
        generateRecord: weeklyPotentialScoreRecord("score", "lowest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Highest realized points ratio",
        generateRecord: weeklyPotentialScoreRecord("ratio", "highest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Lowest realized points ratio",
        generateRecord: weeklyPotentialScoreRecord("ratio", "lowest"),
      },
    ],
  },
  {
    type: "category",
    category: "manager",
    name: "Career Standings",
    children: [
      {
        type: "record",
        category: "manager",
        name: "Most wins",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("win"),
      },
      {
        type: "record",
        category: "manager",
        name: "Most losses",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("loss"),
      },
      {
        type: "record",
        category: "manager",
        name: "Most years in league (YiL)",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("years"),
      },
      {
        type: "record",
        category: "manager",
        name: "Highest win percentage",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("win%"),
      },
      {
        type: "record",
        category: "manager",
        name: "Highest win streak",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("win-streak"),
      },
      {
        type: "record",
        category: "manager",
        name: "Highest loss streak",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("loss-streak"),
      },
    ],
  },
  {
    type: "category",
    category: "manager",
    name: "Career Lineup IQ",
    children: [
      {
        type: "record",
        category: "manager",
        name: "Most perfect lineups",
        displayAll: true,
        generateRecord: managerCareerLineupRecord("perfect-lineups"),
      },
      {
        type: "record",
        category: "manager",
        name: "Fewest total missed points",
        displayAll: true,
        generateRecord: managerCareerLineupRecord("missed-points"),
      },
      {
        type: "record",
        category: "manager",
        name: "Highest lineup IQ",
        displayAll: true,
        generateRecord: managerCareerLineupRecord("lineup-iq"),
      },
    ],
  },
  {
    type: "category",
    category: "manager",
    name: "Career Scores",
    children: [
      {
        type: "record",
        category: "manager",
        name: "Highest highest score",
        displayAll: true,
        generateRecord: managerCareerScoringRecord("high-score"),
      },
      {
        type: "record",
        category: "manager",
        name: "Lowest lowest score",
        displayAll: true,
        generateRecord: managerCareerScoringRecord("low-score"),
      },
      {
        type: "record",
        category: "manager",
        name: "Highest total points forward (PF)",
        displayAll: true,
        generateRecord: managerCareerScoringRecord("points-forward"),
      },
      {
        type: "record",
        category: "manager",
        name: "Highest total points against (PA)",
        displayAll: true,
        generateRecord: managerCareerScoringRecord("points-against"),
      },
      {
        type: "record",
        category: "manager",
        name: "Highest average points forward per game (PFPG)",
        displayAll: true,
        generateRecord: managerCareerScoringRecord("points-forward-per-game"),
      },
      {
        type: "record",
        category: "manager",
        name: "Highest average points against per game (PAPG)",
        displayAll: true,
        generateRecord: managerCareerScoringRecord("points-against-per-game"),
      },
    ],
  },
];

function weeklyScoreRecord(
  sortBy: "score" | "differential" | "loserScore" | "winnerScore",
  sortOrder: "highest" | "lowest"
) {
  interface RecordEntry extends BaseRecordEntry {
    key: string;
    team: string;
    week: string;
    againstTeam: string;
    scores: string;
    score: number;
    scoreDelta: number;
  }

  return function (
    rd: RecordDefinition,
    ld: LeagueDefinition,
    leagues: Record<LeagueId, League>
  ): FantasyRecord<RecordEntry> {
    let dataAvailableFromYear = 9999;

    const entries = ld.years
      .map((yr) => leagues[yr.leagueId])
      .flatMap((league) =>
        league.matchupData.matchups.flatMap((matchup) => {
          if (matchup.team2 === "BYE" || matchup.team2 === "TBD") {
            return;
          }

          const scope: RecordScope =
            matchup.week < league.matchupData.playoffWeekStart
              ? "in-season"
              : league.teamData.playoffQualifiedTeams.includes(matchup.team1.teamId)
                ? "playoffs"
                : "toilet-bowl";

          if (league.year < dataAvailableFromYear) {
            dataAvailableFromYear = league.year;
          }

          const team1 = league.teamData.teams[matchup.team1.teamId];
          const manager1 = league.mangerData.managers[team1.managerId];
          const team2 = league.teamData.teams[matchup.team2.teamId];
          const manager2 = league.mangerData.managers[team2.managerId];

          const scoreDelta = matchup.team1.points - matchup.team2.points;

          return [
            sortBy === "score" || scoreDelta > 0 != (sortBy === "loserScore") // team1 wins
              ? {
                  key: `${matchup.matchupId}-${matchup.leagueId}-${matchup.week}-${matchup.team1.teamId}`,
                  week: `${league.year} WK ${matchup.week}`,
                  team: `${team1.name} (${manager1.name})`,
                  againstTeam: `${team2.name} (${manager2.name})`,
                  scores: `${twoDecimalFormat(matchup.team1.points)} - ${twoDecimalFormat(matchup.team2.points)} (Δ ${twoDecimalFormat(Math.abs(scoreDelta))})`,
                  score: matchup.team1.points,
                  scoreDelta: Math.abs(scoreDelta),
                  league: league.leagueId,
                  scope,
                }
              : undefined,
            sortBy === "score" || scoreDelta < 0 != (sortBy === "loserScore") // team2 wins
              ? {
                  key: `${matchup.matchupId}-${matchup.leagueId}-${matchup.week}-${matchup.team2.teamId}`,
                  week: `${league.year} WK ${matchup.week}`,
                  team: `${team2.name} (${manager2.name})`,
                  againstTeam: `${team1.name} (${manager1.name})`,
                  scores: `${twoDecimalFormat(matchup.team2.points)} - ${twoDecimalFormat(matchup.team1.points)} (Δ ${twoDecimalFormat(Math.abs(scoreDelta))})`,
                  score: matchup.team2.points,
                  scoreDelta: Math.abs(scoreDelta),
                  league: league.leagueId,
                  scope,
                }
              : undefined,
          ];
        })
      )
      .filter((entry) => !!entry)
      .sort((a, b) => {
        const aVal = sortBy === "differential" ? a.scoreDelta : a.score;
        const bVal = sortBy === "differential" ? b.scoreDelta : b.score;
        return (aVal - bVal) * (sortOrder === "lowest" ? 1 : -1);
      });

    return {
      type: "record",
      category: rd.category,
      name: rd.name,
      displayAll: rd.displayAll,
      dataAvailableFromYear,
      columns: [
        {
          key: "team",
          title: "Team / Manager",
          type: "string",
        },
        {
          key: "week",
          title: "Week",
          type: "string",
        },
        {
          key: "againstTeam",
          title: "Opponent",
          type: "string",
        },
        {
          key: "scores",
          title: "Score",
          type: "string",
        },
      ],
      keyField: "key",
      entries: entries,
    };
  };
}

function weeklyTeamwideScoreRecord(scoreType: "total" | "bench", sortOrder: "highest" | "lowest") {
  interface RecordEntry extends BaseRecordEntry {
    key: string;
    team: string;
    week: string;
    againstTeam: string;
    score: number;
    actualScore: number;
    benchScore: number;
  }

  return function (
    rd: RecordDefinition,
    ld: LeagueDefinition,
    leagues: Record<LeagueId, League>
  ): FantasyRecord<RecordEntry> {
    let dataAvailableFromYear = 9999;

    const entries = ld.years
      .map((yr) => leagues[yr.leagueId])
      .flatMap((league) =>
        league.matchupData.matchups.flatMap((matchup) => {
          const res: RecordEntry[] = [];

          const scope: RecordScope =
            matchup.week < league.matchupData.playoffWeekStart
              ? "in-season"
              : league.teamData.playoffQualifiedTeams.includes(matchup.team1.teamId)
                ? "playoffs"
                : "toilet-bowl";

          const team1 = league.teamData.teams[matchup.team1.teamId];
          const manager1 = league.mangerData.managers[team1.managerId];

          let team2Name: string;
          if (matchup.team2 !== "BYE" && matchup.team2 !== "TBD") {
            const team2 = league.teamData.teams[matchup.team2.teamId];
            const manager2 = league.mangerData.managers[(team2 as Team).managerId];
            team2Name = `${team2.name} (${manager2.name})`;

            if (matchup.team2.hasPlayerData) {
              if (league.year < dataAvailableFromYear) {
                dataAvailableFromYear = league.year;
              }

              const team2Score = _.sum(Object.values(matchup.team2.playerPoints));

              res.push({
                key: `${matchup.matchupId}-${matchup.leagueId}-${matchup.week}-${matchup.team2.teamId}`,
                week: `${league.year} WK ${matchup.week}`,
                team: `${team2.name} (${manager2.name})`,
                againstTeam: `${team1.name} (${manager1.name})`,
                score: team2Score,
                actualScore: matchup.team2.points,
                benchScore: team2Score - matchup.team2.points,
                league: league.leagueId,
                scope,
              });
            }
          } else {
            team2Name = matchup.team2;
          }

          if (matchup.team1.hasPlayerData) {
            if (league.year < dataAvailableFromYear) {
              dataAvailableFromYear = league.year;
            }

            const team1Score = _.sum(Object.values(matchup.team1.playerPoints));

            res.push({
              key: `${matchup.matchupId}-${matchup.leagueId}-${matchup.week}-${matchup.team1.teamId}`,
              week: `${league.year} WK ${matchup.week}`,
              team: `${team1.name} (${manager1.name})`,
              againstTeam: team2Name,
              score: team1Score,
              actualScore: matchup.team1.points,
              benchScore: team1Score - matchup.team1.points,
              league: league.leagueId,
              scope,
            });
          }

          return res;
        })
      )
      .filter((entry) => !!entry)
      .sort((a, b) => {
        const aVal = scoreType === "total" ? a.score : a.benchScore;
        const bVal = scoreType === "total" ? b.score : b.benchScore;
        return (aVal - bVal) * (sortOrder === "lowest" ? 1 : -1);
      });

    return {
      type: "record",
      category: rd.category,
      name: rd.name,
      displayAll: rd.displayAll,
      dataAvailableFromYear,
      columns: [
        {
          key: "team",
          title: "Team / Manager",
          type: "string",
        },
        {
          key: "week",
          title: "Week",
          type: "string",
        },
        {
          key: "againstTeam",
          title: "Opponent",
          type: "string",
        },
        {
          key: "score",
          title: "Teamwide Score",
          type: "number",
          decimalPrecision: 2,
        },
        {
          key: "actualScore",
          title: "Actual Score",
          type: "number",
          decimalPrecision: 2,
        },
        {
          key: "benchScore",
          title: "Bench Score",
          type: "number",
          decimalPrecision: 2,
        },
      ],
      keyField: "key",
      entries: entries,
    };
  };
}

function weeklyPotentialScoreRecord(sortBy: "score" | "ratio", sortOrder: "highest" | "lowest") {
  interface RecordEntry extends BaseRecordEntry {
    key: string;
    team: string;
    week: string;
    againstTeam: string;
    score: number;
    actualScore: number;
    realizedScoreRatio: number;
  }

  return function (
    rd: RecordDefinition,
    ld: LeagueDefinition,
    leagues: Record<LeagueId, League>,
    nflData: NFLData
  ): FantasyRecord<RecordEntry> {
    let dataAvailableFromYear = 9999;

    const entries = ld.years
      .map((yr) => leagues[yr.leagueId])
      .flatMap((league) =>
        league.matchupData.matchups.flatMap((matchup) => {
          const res: RecordEntry[] = [];

          const scope: RecordScope =
            matchup.week < league.matchupData.playoffWeekStart
              ? "in-season"
              : league.teamData.playoffQualifiedTeams.includes(matchup.team1.teamId)
                ? "playoffs"
                : "toilet-bowl";

          const team1 = league.teamData.teams[matchup.team1.teamId];
          const manager1 = league.mangerData.managers[team1.managerId];

          let team2Name: string;
          if (matchup.team2 !== "BYE" && matchup.team2 !== "TBD") {
            const team2 = league.teamData.teams[matchup.team2.teamId];
            const manager2 = league.mangerData.managers[(team2 as Team).managerId];
            team2Name = `${team2.name} (${manager2.name})`;

            if (matchup.team2.hasPlayerData) {
              if (league.year < dataAvailableFromYear) {
                dataAvailableFromYear = league.year;
              }

              const team2Score = optimizeScore(
                matchup.team2.players
                  .filter((p) => !!p)
                  .concat(matchup.team2.bench)
                  .concat(matchup.team2.injuryReserve),
                nflData.players,
                matchup.team2.playerPoints,
                league.teamData.rosterPositions
              );

              res.push({
                key: `${matchup.matchupId}-${matchup.leagueId}-${matchup.week}-${matchup.team2.teamId}`,
                week: `${league.year} WK ${matchup.week}`,
                team: `${team2.name} (${manager2.name})`,
                againstTeam: `${team1.name} (${manager1.name})`,
                score: team2Score,
                actualScore: matchup.team2.points,
                realizedScoreRatio: matchup.team2.points / team2Score,
                league: league.leagueId,
                scope,
              });
            }
          } else {
            team2Name = matchup.team2;
          }

          if (matchup.team1.hasPlayerData) {
            if (league.year < dataAvailableFromYear) {
              dataAvailableFromYear = league.year;
            }

            const team1Score = optimizeScore(
              matchup.team1.players
                .filter((p) => !!p)
                .concat(matchup.team1.bench)
                .concat(matchup.team1.injuryReserve),
              nflData.players,
              matchup.team1.playerPoints,
              league.teamData.rosterPositions
            );

            res.push({
              key: `${matchup.matchupId}-${matchup.leagueId}-${matchup.week}-${matchup.team1.teamId}`,
              week: `${league.year} WK ${matchup.week}`,
              team: `${team1.name} (${manager1.name})`,
              againstTeam: team2Name,
              score: team1Score,
              actualScore: matchup.team1.points,
              realizedScoreRatio: matchup.team1.points / team1Score,
              league: league.leagueId,
              scope,
            });
          }

          return res;
        })
      )
      .filter((entry) => !!entry)
      .sort((a, b) => {
        const aVal = sortBy === "score" ? a.score : a.realizedScoreRatio;
        const bVal = sortBy === "score" ? b.score : b.realizedScoreRatio;
        return (aVal - bVal) * (sortOrder === "lowest" ? 1 : -1);
      });

    return {
      type: "record",
      category: rd.category,
      name: rd.name,
      displayAll: rd.displayAll,
      dataAvailableFromYear,
      columns: [
        {
          key: "team",
          title: "Team / Manager",
          type: "string",
        },
        {
          key: "week",
          title: "Week",
          type: "string",
        },
        {
          key: "againstTeam",
          title: "Opponent",
          type: "string",
        },
        {
          key: "score",
          title: "Potential Score",
          type: "number",
          decimalPrecision: 2,
        },
        {
          key: "actualScore",
          title: "Actual Score",
          type: "number",
          decimalPrecision: 2,
        },
        {
          key: "realizedScoreRatio",
          title: "Realized",
          type: "percentage",
          decimalPrecision: 2,
        },
      ],
      keyField: "key",
      entries: entries,
    };
  };
}

function managerCareerStandingsRecord(
  sortBy: "win" | "loss" | "win%" | "win-streak" | "loss-streak" | "years"
) {
  interface RecordEntry extends BaseRecordEntry {
    key: string;
    manager: string;
    wins: number;
    losses: number;
    yearsInLeague: number;
    winPercentage: number;
    longestWinStreak: number;
    longestWinStreakNote?: string;
    longestLossStreak: number;
    longestLossStreakNote?: string;
  }

  return function (
    rd: RecordDefinition,
    ld: LeagueDefinition,
    leagues: Record<LeagueId, League>
  ): FantasyRecord<RecordEntry> {
    let dataAvailableFromYear = 9999;

    const managers = _.uniqBy(
      ld.years
        .map((league) => leagues[league.leagueId])
        .flatMap((league) => Object.values(league.mangerData.managers)),
      (el) => el.managerId
    );

    function initMap(): Record<ManagerId, Record<LeagueId, number>> {
      return Object.fromEntries(
        managers.map((manager) => [
          manager.managerId,
          Object.fromEntries(ld.years.map((league) => [league.leagueId, 0])),
        ])
      );
    }

    function initStreaksMap(): Record<ManagerId, { streak: number; type: "W" | "L" }> {
      return Object.fromEntries(
        managers.map((manager) => [manager.managerId, { streak: 0, type: "W" }])
      );
    }

    const seasonWins = initMap();
    const seasonLosses = initMap();

    const playoffWins = initMap();
    const playoffLosses = initMap();

    const seasonMedianWins = initMap();
    const seasonMedianLosses = initMap();

    const longestSeasonWinStreaks = initMap();
    const longestPlayoffWinStreaks = initMap();
    const longestMedianWinStreaks = initMap();
    const longestTotalWinStreaks = initMap();

    const longestSeasonLossStreaks = initMap();
    const longestPlayoffLossStreaks = initMap();
    const longestMedianLossStreaks = initMap();
    const longestTotalLossStreaks = initMap();

    const yearsInLeague: Record<ManagerId, Set<number>> = Object.fromEntries(
      managers.map((manager) => [manager.managerId, new Set<number>()])
    );

    let currentSeasonStreaks: Record<ManagerId, { streak: number; type: "W" | "L" }>;
    let currentPlayoffStreaks: Record<ManagerId, { streak: number; type: "W" | "L" }>;
    let currentMedianStreaks: Record<ManagerId, { streak: number; type: "W" | "L" }>;
    let currentTotalStreaks: Record<ManagerId, { streak: number; type: "W" | "L" }>;

    ld.years
      .map((league) => leagues[league.leagueId])
      .forEach((league) => {
        const leagueId = league.leagueId;

        currentSeasonStreaks = initStreaksMap();
        currentPlayoffStreaks = initStreaksMap();
        currentMedianStreaks = initStreaksMap();
        currentTotalStreaks = initStreaksMap();

        // Compute medians
        const scoresPerWeek: Record<number, number[]> = {};
        for (const matchup of league.matchupData.matchups) {
          if (matchup.team2 === "BYE" || matchup.team2 === "TBD") {
            continue;
          }

          if (!scoresPerWeek[matchup.week]) {
            scoresPerWeek[matchup.week] = [];
          }
          scoresPerWeek[matchup.week].push(matchup.team1.points, matchup.team2.points);
        }
        const mediansPerWeek: Record<number, number> = {};
        for (const week in scoresPerWeek) {
          const scores = scoresPerWeek[week];
          scores.sort((a, b) => a - b);
          const midIndex = Math.floor(scores.length / 2);
          mediansPerWeek[Number(week)] =
            scores.length % 2 === 0
              ? (scores[midIndex - 1] + scores[midIndex]) / 2
              : scores[midIndex];
        }

        // Process matchups
        for (const matchup of league.matchupData.matchups.sort((a, b) => a.week - b.week)) {
          if (matchup.team2 === "BYE" || matchup.team2 === "TBD") {
            continue;
          }

          const isPlayoff = matchup.week >= league.matchupData.playoffWeekStart;

          if (league.year < dataAvailableFromYear) {
            dataAvailableFromYear = league.year;
          }

          // Determine winner and loser
          const didTeam1Win = matchup.team1.points > matchup.team2.points;
          const team1Id = matchup.team1.teamId;
          const team2Id = matchup.team2.teamId;
          const winnerTeamId = didTeam1Win ? matchup.team1.teamId : matchup.team2.teamId;
          const loserTeamId = didTeam1Win ? matchup.team2.teamId : matchup.team1.teamId;

          // Get manager IDs of winner and loser
          const winner = Object.keys(league.mangerData.teamAssignments).find(
            (managerId) =>
              league.mangerData.teamAssignments[managerId as ManagerId] === winnerTeamId
          ) as ManagerId;
          const loser = Object.keys(league.mangerData.teamAssignments).find(
            (managerId) => league.mangerData.teamAssignments[managerId as ManagerId] === loserTeamId
          ) as ManagerId;
          const team1 = Object.keys(league.mangerData.teamAssignments).find(
            (managerId) => league.mangerData.teamAssignments[managerId as ManagerId] === team1Id
          ) as ManagerId;
          const team2 = Object.keys(league.mangerData.teamAssignments).find(
            (managerId) => league.mangerData.teamAssignments[managerId as ManagerId] === team2Id
          ) as ManagerId;

          // Count wins and losses
          if (!isPlayoff) {
            seasonWins[winner][leagueId] += 1;
          } else {
            playoffWins[winner][leagueId] += 1;
          }

          if (!isPlayoff) {
            seasonLosses[loser][leagueId] += 1;
          } else {
            playoffLosses[loser][leagueId] += 1;
          }

          // Count median wins and losses
          if (!isPlayoff) {
            if (matchup.team1.points >= mediansPerWeek[matchup.week]) {
              seasonMedianWins[team1][leagueId] += 1;
            } else {
              seasonMedianLosses[team1][leagueId] += 1;
            }
            if (matchup.team2.points >= mediansPerWeek[matchup.week]) {
              seasonMedianWins[team2][leagueId] += 1;
            } else {
              seasonMedianLosses[team2][leagueId] += 1;
            }
          }

          // Count years in league
          yearsInLeague[winner].add(league.year);
          yearsInLeague[loser].add(league.year);

          // Total Streaks
          if (currentTotalStreaks[winner].type === "W") {
            // WINNER: Continuing a win streak
            currentTotalStreaks[winner].streak += 1;
          } else {
            // WINNER: Starting a win streak
            if (currentTotalStreaks[winner].streak > longestTotalLossStreaks[winner][leagueId]) {
              longestTotalLossStreaks[winner][leagueId] = currentTotalStreaks[winner].streak;
            }
            currentTotalStreaks[winner] = { streak: 1, type: "W" };
          }

          if (currentTotalStreaks[loser].type === "L") {
            // LOSER: Continuing a loss streak
            currentTotalStreaks[loser].streak += 1;
          } else {
            // LOSER: Starting a loss streak
            if (currentTotalStreaks[loser].streak > longestTotalWinStreaks[loser][leagueId]) {
              longestTotalWinStreaks[loser][leagueId] = currentTotalStreaks[loser].streak;
            }
            currentTotalStreaks[loser] = { streak: 1, type: "L" };
          }

          // Season and Playoff Streaks
          if (!isPlayoff) {
            // WINNER: Regular season streaks
            if (currentSeasonStreaks[winner].type === "W") {
              // WINNER: Continuing a win streak
              currentSeasonStreaks[winner].streak += 1;
            } else {
              // WINNER: Starting a win streak
              if (
                currentSeasonStreaks[winner].streak > longestSeasonLossStreaks[winner][leagueId]
              ) {
                longestSeasonLossStreaks[winner][leagueId] = currentSeasonStreaks[winner].streak;
              }
              currentSeasonStreaks[winner] = { streak: 1, type: "W" };
            }
          } else {
            // WINNER: Playoff streaks
            if (currentPlayoffStreaks[winner].type === "W") {
              // WINNER: Continuing a win streak
              currentPlayoffStreaks[winner].streak += 1;
            } else {
              // WINNER: Starting a win streak
              if (
                currentPlayoffStreaks[winner].streak > longestPlayoffLossStreaks[winner][leagueId]
              ) {
                longestPlayoffLossStreaks[winner][leagueId] = currentPlayoffStreaks[winner].streak;
              }
              currentPlayoffStreaks[winner] = { streak: 1, type: "W" };
            }
          }

          if (!isPlayoff) {
            // LOSER: Regular season streaks
            if (currentSeasonStreaks[loser].type === "L") {
              // LOSER: Continuing a loss streak
              currentSeasonStreaks[loser].streak += 1;
            } else {
              // LOSER: Starting a loss streak
              if (currentSeasonStreaks[loser].streak > longestSeasonWinStreaks[loser][leagueId]) {
                longestSeasonWinStreaks[loser][leagueId] = currentSeasonStreaks[loser].streak;
              }
              currentSeasonStreaks[loser] = { streak: 1, type: "L" };
            }
          } else {
            // LOSER: Playoff streaks
            if (currentPlayoffStreaks[loser].type === "L") {
              // LOSER: Continuing a loss streak
              currentPlayoffStreaks[loser].streak += 1;
            } else {
              // LOSER: Starting a loss streak
              if (currentPlayoffStreaks[loser].streak > longestPlayoffWinStreaks[loser][leagueId]) {
                longestPlayoffWinStreaks[loser][leagueId] = currentPlayoffStreaks[loser].streak;
              }
              currentPlayoffStreaks[loser] = { streak: 1, type: "L" };
            }
          }

          // Median Streaks
          if (!isPlayoff) {
            // Team 1
            if (matchup.team1.points >= mediansPerWeek[matchup.week]) {
              // TEAM 1: BEAT MEDIAN
              if (currentMedianStreaks[team1].type === "W") {
                // TEAM 1: Continuing win streak
                currentMedianStreaks[team1].streak += 1;
              } else {
                // TEAM 1: Starting win streak
                if (
                  currentMedianStreaks[team1].streak > longestMedianLossStreaks[team1][leagueId]
                ) {
                  longestMedianLossStreaks[team1][leagueId] = currentMedianStreaks[team1].streak;
                }
                currentMedianStreaks[team1] = { streak: 1, type: "W" };
              }
            } else {
              // TEAM 1: MISSED MEDIAN
              if (currentMedianStreaks[team1].type === "L") {
                // TEAM 1: Continuing loss streak
                currentMedianStreaks[team1].streak += 1;
              } else {
                // TEAM 1: Starting loss streak
                if (currentMedianStreaks[team1].streak > longestMedianWinStreaks[team1][leagueId]) {
                  longestMedianWinStreaks[team1][leagueId] = currentMedianStreaks[team1].streak;
                }
                currentMedianStreaks[team1] = { streak: 1, type: "L" };
              }
            }

            // Team 2
            if (matchup.team2.points >= mediansPerWeek[matchup.week]) {
              // TEAM 2: BEAT MEDIAN
              if (currentMedianStreaks[team2].type === "W") {
                // TEAM 2: Continuing win streak
                currentMedianStreaks[team2].streak += 1;
              } else {
                // TEAM 2: Starting win streak
                if (
                  currentMedianStreaks[team2].streak > longestMedianLossStreaks[team2][leagueId]
                ) {
                  longestMedianLossStreaks[team2][leagueId] = currentMedianStreaks[team2].streak;
                }
                currentMedianStreaks[team2] = { streak: 1, type: "W" };
              }
            } else {
              // TEAM 2: MISSED MEDIAN
              if (currentMedianStreaks[team2].type === "L") {
                // TEAM 2: Continuing loss streak
                currentMedianStreaks[team2].streak += 1;
              } else {
                // TEAM 2: Starting loss streak
                if (currentMedianStreaks[team2].streak > longestMedianWinStreaks[team2][leagueId]) {
                  longestMedianWinStreaks[team2][leagueId] = currentMedianStreaks[team2].streak;
                }
                currentMedianStreaks[team2] = { streak: 1, type: "L" };
              }
            }
          }
        }

        // Check if current streaks are the longest for each manager
        for (const manager of Object.keys(currentTotalStreaks) as ManagerId[]) {
          // Total
          if (
            currentTotalStreaks[manager].type === "W" &&
            currentTotalStreaks[manager].streak > longestTotalWinStreaks[manager][leagueId]
          ) {
            longestTotalWinStreaks[manager][leagueId] = currentTotalStreaks[manager].streak;
          }
          if (
            currentTotalStreaks[manager].type === "L" &&
            currentTotalStreaks[manager].streak > longestTotalLossStreaks[manager][leagueId]
          ) {
            longestTotalLossStreaks[manager][leagueId] = currentTotalStreaks[manager].streak;
          }

          // Season
          if (
            currentSeasonStreaks[manager].type === "W" &&
            currentSeasonStreaks[manager].streak > longestSeasonWinStreaks[manager][leagueId]
          ) {
            longestSeasonWinStreaks[manager][leagueId] = currentSeasonStreaks[manager].streak;
          }
          if (
            currentSeasonStreaks[manager].type === "L" &&
            currentSeasonStreaks[manager].streak > longestSeasonLossStreaks[manager][leagueId]
          ) {
            longestSeasonLossStreaks[manager][leagueId] = currentSeasonStreaks[manager].streak;
          }

          // Playoff
          if (
            currentPlayoffStreaks[manager].type === "W" &&
            currentPlayoffStreaks[manager].streak > longestPlayoffWinStreaks[manager][leagueId]
          ) {
            longestPlayoffWinStreaks[manager][leagueId] = currentPlayoffStreaks[manager].streak;
          }
          if (
            currentPlayoffStreaks[manager].type === "L" &&
            currentPlayoffStreaks[manager].streak > longestPlayoffLossStreaks[manager][leagueId]
          ) {
            longestPlayoffLossStreaks[manager][leagueId] = currentPlayoffStreaks[manager].streak;
          }
        }
      });

    const entries = managers
      .flatMap<RecordEntry>((manager) => {
        const records: RecordEntry[] = [];

        for (const scope of [undefined, "in-season", "postseason"] as const) {
          for (const medianMethod of [
            "no-medians",
            "only-medians",
            "include-medians",
            "default",
          ] as const) {
            for (const league of [undefined, ...ld.years]) {
              const leagueId = league?.leagueId;

              let wins = 0;
              let losses = 0;
              let longestWinStreak = 0;
              let longestWinStreakNote: string | undefined = undefined;
              let longestLossStreak = 0;
              let longestLossStreakNote: string | undefined = undefined;

              // Count wins and losses
              if (leagueId) {
                // Individual league
                const actualMedianMethod =
                  medianMethod === "default"
                    ? leagues[leagueId].matchupData.medianEnabled
                      ? "include-medians"
                      : "no-medians"
                    : medianMethod;

                // Count non-median wins and losses
                if (actualMedianMethod !== "only-medians") {
                  // Count regular season wins and losses
                  if (scope !== "postseason") {
                    wins += seasonWins[manager.managerId][leagueId];
                    losses += seasonLosses[manager.managerId][leagueId];
                  }

                  // Count playoff wins and losses
                  if (scope !== "in-season") {
                    wins += playoffWins[manager.managerId][leagueId];
                    losses += playoffLosses[manager.managerId][leagueId];
                  }
                }

                // Count median wins and losses
                if (actualMedianMethod !== "no-medians") {
                  wins += seasonMedianWins[manager.managerId][leagueId];
                  losses += seasonMedianLosses[manager.managerId][leagueId];
                }
              } else {
                // League aggregate

                for (const league of ld.years) {
                  const actualMedianMethod =
                    medianMethod === "default"
                      ? leagues[league.leagueId].matchupData.medianEnabled
                        ? "include-medians"
                        : "no-medians"
                      : medianMethod;

                  // Count non-median wins and losses
                  if (actualMedianMethod !== "only-medians") {
                    // Count regular season wins and losses
                    if (scope !== "postseason") {
                      wins += seasonWins[manager.managerId][league.leagueId];
                      losses += seasonLosses[manager.managerId][league.leagueId];
                    }

                    // Count playoff wins and losses
                    if (scope !== "in-season") {
                      wins += playoffWins[manager.managerId][league.leagueId];
                      losses += playoffLosses[manager.managerId][league.leagueId];
                    }
                  }

                  // Count median wins and losses
                  if (actualMedianMethod !== "no-medians") {
                    wins += seasonMedianWins[manager.managerId][league.leagueId];
                    losses += seasonMedianLosses[manager.managerId][league.leagueId];
                  }
                }
              }

              // Get longest win streak
              if (leagueId) {
                // Individual league
                const actualMedianMethod =
                  medianMethod === "default"
                    ? leagues[leagueId].matchupData.medianEnabled
                      ? "include-medians"
                      : "no-medians"
                    : medianMethod;

                if (actualMedianMethod === "only-medians") {
                  // Only median streaks
                  longestWinStreak = longestMedianWinStreaks[manager.managerId][leagueId];
                  longestLossStreak = longestMedianLossStreaks[manager.managerId][leagueId];
                } else {
                  switch (scope) {
                    case "in-season":
                      longestWinStreak = longestSeasonWinStreaks[manager.managerId][leagueId];
                      longestLossStreak = longestSeasonLossStreaks[manager.managerId][leagueId];
                      break;
                    case "postseason":
                      longestWinStreak = longestPlayoffWinStreaks[manager.managerId][leagueId];
                      longestLossStreak = longestPlayoffLossStreaks[manager.managerId][leagueId];
                      break;
                    default:
                      longestWinStreak = longestTotalWinStreaks[manager.managerId][leagueId];
                      longestLossStreak = longestTotalLossStreaks[manager.managerId][leagueId];
                      break;
                  }
                }
              } else {
                // Aggregate across all years
                for (const league of ld.years) {
                  const actualMedianMethod =
                    medianMethod === "default"
                      ? leagues[league.leagueId].matchupData.medianEnabled
                        ? "include-medians"
                        : "no-medians"
                      : medianMethod;

                  if (actualMedianMethod === "only-medians") {
                    // Only median streaks
                    if (
                      longestMedianWinStreaks[manager.managerId][league.leagueId] > longestWinStreak
                    ) {
                      longestWinStreak =
                        longestMedianWinStreaks[manager.managerId][league.leagueId];
                      longestWinStreakNote = `${league.year}`;
                    }
                    if (
                      longestMedianLossStreaks[manager.managerId][league.leagueId] >
                      longestLossStreak
                    ) {
                      longestLossStreak =
                        longestMedianLossStreaks[manager.managerId][league.leagueId];
                      longestLossStreakNote = `${league.year}`;
                    }
                  } else {
                    switch (scope) {
                      case "in-season":
                        if (
                          longestSeasonWinStreaks[manager.managerId][league.leagueId] >
                          longestWinStreak
                        ) {
                          longestWinStreak =
                            longestSeasonWinStreaks[manager.managerId][league.leagueId];
                          longestWinStreakNote = `${league.year}`;
                        }
                        if (
                          longestSeasonLossStreaks[manager.managerId][league.leagueId] >
                          longestLossStreak
                        ) {
                          longestLossStreak =
                            longestSeasonLossStreaks[manager.managerId][league.leagueId];
                          longestLossStreakNote = `${league.year}`;
                        }
                        break;
                      case "postseason":
                        if (
                          longestPlayoffWinStreaks[manager.managerId][league.leagueId] >
                          longestWinStreak
                        ) {
                          longestWinStreak =
                            longestPlayoffWinStreaks[manager.managerId][league.leagueId];
                          longestWinStreakNote = `${league.year}`;
                        }
                        if (
                          longestPlayoffLossStreaks[manager.managerId][league.leagueId] >
                          longestLossStreak
                        ) {
                          longestLossStreak =
                            longestPlayoffLossStreaks[manager.managerId][league.leagueId];
                          longestLossStreakNote = `${league.year}`;
                        }
                        break;
                      default:
                        if (
                          longestTotalWinStreaks[manager.managerId][league.leagueId] >
                          longestWinStreak
                        ) {
                          longestWinStreak =
                            longestTotalWinStreaks[manager.managerId][league.leagueId];
                          longestWinStreakNote = `${league.year}`;
                        }
                        if (
                          longestTotalLossStreaks[manager.managerId][league.leagueId] >
                          longestLossStreak
                        ) {
                          longestLossStreak =
                            longestTotalLossStreaks[manager.managerId][league.leagueId];
                          longestLossStreakNote = `${league.year}`;
                        }
                        break;
                    }
                  }
                }
              }

              if (wins + losses > 0) {
                records.push({
                  key:
                    manager.managerId +
                    (leagueId ? `-${leagueId}` : "") +
                    (scope ? `-${scope}` : "") +
                    (medianMethod ? `-${medianMethod}` : ""),
                  manager: manager.name,
                  wins,
                  losses,
                  yearsInLeague: yearsInLeague[manager.managerId].size,
                  winPercentage: wins / (wins + losses),
                  longestWinStreak,
                  longestWinStreakNote,
                  longestLossStreak,
                  longestLossStreakNote,
                  league: leagueId,
                  scope,
                  medianMethod,
                });
              }
            }
          }
        }

        return records;
      })
      .sort((a, b) => {
        const aVal =
          sortBy === "win"
            ? a.wins
            : sortBy === "loss"
              ? a.losses
              : sortBy === "years"
                ? a.yearsInLeague
                : sortBy === "win-streak"
                  ? (a.longestWinStreak ?? -1)
                  : sortBy === "loss-streak"
                    ? (a.longestLossStreak ?? -1)
                    : a.winPercentage;
        const bVal =
          sortBy === "win"
            ? b.wins
            : sortBy === "loss"
              ? b.losses
              : sortBy === "years"
                ? b.yearsInLeague
                : sortBy === "win-streak"
                  ? (b.longestWinStreak ?? -1)
                  : sortBy === "loss-streak"
                    ? (b.longestLossStreak ?? -1)
                    : b.winPercentage;
        return bVal - aVal;
      });

    return {
      type: "record",
      category: rd.category,
      name: rd.name,
      displayAll: rd.displayAll,
      dataAvailableFromYear,
      columns: [
        {
          key: "manager",
          title: "Manager",
          type: "string",
        },
        {
          key: "yearsInLeague",
          title: "YiL",
          type: "number",
        },
        {
          key: "wins",
          title: "Wins",
          type: "number",
        },
        {
          key: "losses",
          title: "Losses",
          type: "number",
        },
        {
          key: "winPercentage",
          title: "Win %",
          type: "percentage",
          decimalPrecision: 2,
        },
        {
          key: "longestWinStreak",
          hintKey: "longestWinStreakNote",
          title: "Longest Win Streak",
          type: "number",
        },
        {
          key: "longestLossStreak",
          hintKey: "longestLossStreakNote",
          title: "Longest Loss Streak",
          type: "number",
        },
      ],
      keyField: "key",
      entries,
    };
  };
}

function managerCareerLineupRecord(sortBy: "perfect-lineups" | "missed-points" | "lineup-iq") {
  interface RecordEntry extends BaseRecordEntry {
    key: string;
    manager: string;
    perfectLineups: number;
    missedPoints: number;
    lineupIQ: number;
  }

  return function (
    rd: RecordDefinition,
    ld: LeagueDefinition,
    leagues: Record<LeagueId, League>,
    nflData: NFLData
  ): FantasyRecord<RecordEntry> {
    let dataAvailableFromYear = 9999;

    const managers = _.uniqBy(
      ld.years
        .map((league) => leagues[league.leagueId])
        .flatMap((league) => Object.values(league.mangerData.managers)),
      (el) => el.managerId
    );

    function initMap(): Record<ManagerId, Record<LeagueId, number>> {
      return Object.fromEntries(
        managers.map((manager) => [
          manager.managerId,
          Object.fromEntries(ld.years.map((league) => [league.leagueId, 0])),
        ])
      );
    }

    const perfectLineupsRegular = initMap();
    const perfectLineupsPlayoff = initMap();
    const potentialPointsRegular = initMap();
    const potentialPointsPlayoff = initMap();
    const realizedPointsRegular = initMap();
    const realizedPointsPlayoff = initMap();

    ld.years
      .map((league) => leagues[league.leagueId])
      .forEach((league) => {
        const leagueId = league.leagueId;
        for (const matchup of league.matchupData.matchups) {
          const isPlayoff = matchup.week >= league.matchupData.playoffWeekStart;

          // TEAM 1
          if (matchup.team1.hasPlayerData) {
            if (league.year < dataAvailableFromYear) {
              dataAvailableFromYear = league.year;
            }

            const potentialScore = optimizeScore(
              matchup.team1.players
                .filter((p) => !!p)
                .concat(matchup.team1.bench)
                .concat(matchup.team1.injuryReserve),
              nflData.players,
              matchup.team1.playerPoints,
              league.teamData.rosterPositions
            );
            const actualScore = matchup.team1.points;

            const teamId = matchup.team1.teamId;
            const managerId = Object.keys(league.mangerData.teamAssignments).find(
              (managerId) => league.mangerData.teamAssignments[managerId as ManagerId] === teamId
            ) as ManagerId;

            if (!isPlayoff) {
              realizedPointsRegular[managerId][leagueId] += actualScore;
              potentialPointsRegular[managerId][leagueId] += potentialScore;
              if (actualScore / potentialScore > 0.999) {
                perfectLineupsRegular[managerId][leagueId] += 1;
              }
            } else {
              realizedPointsPlayoff[managerId][leagueId] += actualScore;
              potentialPointsPlayoff[managerId][leagueId] += potentialScore;
              if (actualScore / potentialScore > 0.999) {
                perfectLineupsPlayoff[managerId][leagueId] += 1;
              }
            }
          }

          // TEAM 2
          if (matchup.team2 !== "BYE" && matchup.team2 !== "TBD" && matchup.team2.hasPlayerData) {
            if (league.year < dataAvailableFromYear) {
              dataAvailableFromYear = league.year;
            }

            const potentialScore = optimizeScore(
              matchup.team2.players
                .filter((p) => !!p)
                .concat(matchup.team2.bench)
                .concat(matchup.team2.injuryReserve),
              nflData.players,
              matchup.team2.playerPoints,
              league.teamData.rosterPositions
            );
            const actualScore = matchup.team2.points;

            const teamId = matchup.team2.teamId;
            const managerId = Object.keys(league.mangerData.teamAssignments).find(
              (managerId) => league.mangerData.teamAssignments[managerId as ManagerId] === teamId
            ) as ManagerId;

            if (!isPlayoff) {
              realizedPointsRegular[managerId][leagueId] += actualScore;
              potentialPointsRegular[managerId][leagueId] += potentialScore;
              if (actualScore / potentialScore > 0.999) {
                perfectLineupsRegular[managerId][leagueId] += 1;
              }
            } else {
              realizedPointsPlayoff[managerId][leagueId] += actualScore;
              potentialPointsPlayoff[managerId][leagueId] += potentialScore;
              if (actualScore / potentialScore > 0.999) {
                perfectLineupsPlayoff[managerId][leagueId] += 1;
              }
            }
          }
        }
      });

    const entries = (Object.keys(realizedPointsPlayoff) as ManagerId[])
      .flatMap<RecordEntry>((managerId) => {
        const records: RecordEntry[] = [];

        for (const scope of [undefined, "in-season", "postseason"] as const) {
          for (const league of [undefined, ...ld.years]) {
            const leagueId = league?.leagueId;

            const manager = managers.find((m) => m.managerId == managerId)!;

            let perfectLineups = 0;
            let potentialPoints = 0;
            let realizedPoints = 0;

            if (leagueId) {
              // Inidividual league
              if (scope !== "postseason") {
                // Regular season scope
                perfectLineups += perfectLineupsRegular[managerId][leagueId];
                potentialPoints += potentialPointsRegular[managerId][leagueId];
                realizedPoints += realizedPointsRegular[managerId][leagueId];
              }
              if (scope !== "in-season") {
                // Postseason scope
                perfectLineups += perfectLineupsPlayoff[managerId][leagueId];
                potentialPoints += potentialPointsPlayoff[managerId][leagueId];
                realizedPoints += realizedPointsPlayoff[managerId][leagueId];
              }
            } else {
              // Aggregate across all years
              for (const league of ld.years) {
                if (scope !== "postseason") {
                  // Regular season scope
                  perfectLineups += perfectLineupsRegular[managerId][league.leagueId];
                  potentialPoints += potentialPointsRegular[managerId][league.leagueId];
                  realizedPoints += realizedPointsRegular[managerId][league.leagueId];
                }
                if (scope !== "in-season") {
                  // Postseason scope
                  perfectLineups += perfectLineupsPlayoff[managerId][league.leagueId];
                  potentialPoints += potentialPointsPlayoff[managerId][league.leagueId];
                  realizedPoints += realizedPointsPlayoff[managerId][league.leagueId];
                }
              }
            }

            if (realizedPoints > 0) {
              records.push({
                key:
                  manager.managerId + (leagueId ? `-${leagueId}` : "") + (scope ? `-${scope}` : ""),
                manager: manager.name,
                perfectLineups,
                missedPoints: potentialPoints - realizedPoints,
                lineupIQ: realizedPoints / potentialPoints,
                league: leagueId,
                scope,
              });
            }
          }
        }

        return records;
      })
      .sort((a, b) => {
        const aVal =
          sortBy === "lineup-iq"
            ? a.lineupIQ
            : sortBy === "missed-points"
              ? -a.missedPoints
              : a.perfectLineups;
        const bVal =
          sortBy === "lineup-iq"
            ? b.lineupIQ
            : sortBy === "missed-points"
              ? -b.missedPoints
              : b.perfectLineups;
        return bVal - aVal;
      });

    return {
      type: "record",
      category: rd.category,
      name: rd.name,
      displayAll: rd.displayAll,
      dataAvailableFromYear,
      columns: [
        {
          key: "manager",
          title: "Manager",
          type: "string",
        },
        {
          key: "perfectLineups",
          title: "Perfect Lineups",
          type: "number",
        },
        {
          key: "missedPoints",
          title: "Total Missed Points",
          type: "number",
          decimalPrecision: 2,
        },
        {
          key: "lineupIQ",
          title: "Lineup IQ",
          type: "percentage",
          decimalPrecision: 2,
        },
      ],
      keyField: "key",
      entries,
    };
  };
}

function managerCareerScoringRecord(
  sortBy:
    | "high-score"
    | "low-score"
    | "points-forward"
    | "points-against"
    | "points-forward-per-game"
    | "points-against-per-game"
) {
  interface RecordEntry extends BaseRecordEntry {
    key: string;
    manager: string;
    highestScore: number;
    highestScoreWeek: string;
    lowestScore: number;
    lowestScoreWeek: string;
    pointsForward: number;
    pointsAgainst: number;
    numGames: number;
    pointsForwardPerGame: number;
    pointsAgainstPerGame: number;
  }

  return function (
    rd: RecordDefinition,
    ld: LeagueDefinition,
    leagues: Record<LeagueId, League>
  ): FantasyRecord<RecordEntry> {
    let dataAvailableFromYear = 9999;

    const managers = _.uniqBy(
      ld.years
        .map((league) => leagues[league.leagueId])
        .flatMap((league) => Object.values(league.mangerData.managers)),
      (el) => el.managerId
    );

    function initMap<T>(val: T): Record<ManagerId, Record<LeagueId, T>> {
      return Object.fromEntries(
        managers.map((manager) => [
          manager.managerId,
          Object.fromEntries(ld.years.map((league) => [league.leagueId, val])),
        ])
      );
    }

    const highestScoreRegular = initMap(0);
    const highestScorePlayoff = initMap(0);
    const lowestScoreRegular = initMap(9999);
    const lowestScorePlayoff = initMap(9999);

    const highestScoreRegularWeek = initMap("N/A");
    const highestScorePlayoffWeek = initMap("N/A");
    const lowestScoreRegularWeek = initMap("N/A");
    const lowestScorePlayoffWeek = initMap("N/A");

    const pointsForwardRegular = initMap(0);
    const pointsForwardPlayoff = initMap(0);
    const pointsAgainstRegular = initMap(0);
    const pointsAgainstPlayoff = initMap(0);

    const numGamesRegular = initMap(0);
    const numGamesPlayoff = initMap(0);

    ld.years
      .map((league) => leagues[league.leagueId])
      .forEach((league) => {
        const leagueId = league.leagueId;

        for (const matchup of league.matchupData.matchups) {
          if (matchup.team2 === "BYE" || matchup.team2 === "TBD") {
            continue;
          }

          if (league.year < dataAvailableFromYear) {
            dataAvailableFromYear = league.year;
          }

          const isPlayoff = matchup.week >= league.matchupData.playoffWeekStart;

          const team1Id = matchup.team1.teamId;
          const manager1Id = Object.keys(league.mangerData.teamAssignments).find(
            (managerId) => league.mangerData.teamAssignments[managerId as ManagerId] === team1Id
          ) as ManagerId;

          const team2Id = matchup.team2.teamId;
          const manager2Id = Object.keys(league.mangerData.teamAssignments).find(
            (managerId) => league.mangerData.teamAssignments[managerId as ManagerId] === team2Id
          ) as ManagerId;

          if (!isPlayoff) {
            if (matchup.team1.points > highestScoreRegular[manager1Id][leagueId]) {
              highestScoreRegular[manager1Id][leagueId] = matchup.team1.points;
              highestScoreRegularWeek[manager1Id][leagueId] = `${league.year} WK ${matchup.week}`;
            }
            if (matchup.team2.points > highestScoreRegular[manager2Id][leagueId]) {
              highestScoreRegular[manager2Id][leagueId] = matchup.team2.points;
              highestScoreRegularWeek[manager2Id][leagueId] = `${league.year} WK ${matchup.week}`;
            }

            if (matchup.team1.points < lowestScoreRegular[manager1Id][leagueId]) {
              lowestScoreRegular[manager1Id][leagueId] = matchup.team1.points;
              lowestScoreRegularWeek[manager1Id][leagueId] = `${league.year} WK ${matchup.week}`;
            }
            if (matchup.team2.points < lowestScoreRegular[manager2Id][leagueId]) {
              lowestScoreRegular[manager2Id][leagueId] = matchup.team2.points;
              lowestScoreRegularWeek[manager2Id][leagueId] = `${league.year} WK ${matchup.week}`;
            }

            pointsForwardRegular[manager1Id][leagueId] += matchup.team1.points;
            pointsForwardRegular[manager2Id][leagueId] += matchup.team2.points;

            pointsAgainstRegular[manager1Id][leagueId] += matchup.team2.points;
            pointsAgainstRegular[manager2Id][leagueId] += matchup.team1.points;

            numGamesRegular[manager1Id][leagueId] += 1;
            numGamesRegular[manager2Id][leagueId] += 1;
          } else {
            if (matchup.team1.points > highestScorePlayoff[manager1Id][leagueId]) {
              highestScorePlayoff[manager1Id][leagueId] = matchup.team1.points;
              highestScorePlayoffWeek[manager1Id][leagueId] = `${league.year} WK ${matchup.week}`;
            }
            if (matchup.team2.points > highestScorePlayoff[manager2Id][leagueId]) {
              highestScorePlayoff[manager2Id][leagueId] = matchup.team2.points;
              highestScorePlayoffWeek[manager2Id][leagueId] = `${league.year} WK ${matchup.week}`;
            }

            if (matchup.team1.points < lowestScorePlayoff[manager1Id][leagueId]) {
              lowestScorePlayoff[manager1Id][leagueId] = matchup.team1.points;
              lowestScorePlayoffWeek[manager1Id][leagueId] = `${league.year} WK ${matchup.week}`;
            }
            if (matchup.team2.points < lowestScorePlayoff[manager2Id][leagueId]) {
              lowestScorePlayoff[manager2Id][leagueId] = matchup.team2.points;
              lowestScorePlayoffWeek[manager2Id][leagueId] = `${league.year} WK ${matchup.week}`;
            }

            pointsForwardPlayoff[manager1Id][leagueId] += matchup.team1.points;
            pointsForwardPlayoff[manager2Id][leagueId] += matchup.team2.points;

            pointsAgainstPlayoff[manager1Id][leagueId] += matchup.team2.points;
            pointsAgainstPlayoff[manager2Id][leagueId] += matchup.team1.points;

            numGamesPlayoff[manager1Id][leagueId] += 1;
            numGamesPlayoff[manager2Id][leagueId] += 1;
          }
        }
      });

    const entries = managers
      .flatMap<RecordEntry>((manager) => {
        const records: RecordEntry[] = [];

        for (const scope of [undefined, "in-season", "postseason"] as const) {
          for (const league of [undefined, ...ld.years]) {
            const leagueId = league?.leagueId;

            let highestScore = 0;
            let highestScoreWeek = "N/A";
            let lowestScore = 9999;
            let lowestScoreWeek = "N/A";
            let pointsForward = 0;
            let pointsAgainst = 0;
            let numGames = 0;

            if (leagueId) {
              // Individual league
              if (scope !== "postseason") {
                // Regular season scope
                if (highestScoreRegular[manager.managerId][leagueId] > highestScore) {
                  highestScore = highestScoreRegular[manager.managerId][leagueId];
                  highestScoreWeek = highestScoreRegularWeek[manager.managerId][leagueId];
                }
                if (lowestScoreRegular[manager.managerId][leagueId] < lowestScore) {
                  lowestScore = lowestScoreRegular[manager.managerId][leagueId];
                  lowestScoreWeek = lowestScoreRegularWeek[manager.managerId][leagueId];
                }
                pointsForward += pointsForwardRegular[manager.managerId][leagueId];
                pointsAgainst += pointsAgainstRegular[manager.managerId][leagueId];
                numGames += numGamesRegular[manager.managerId][leagueId];
              }
              if (scope !== "in-season") {
                // Postseason scope
                if (highestScorePlayoff[manager.managerId][leagueId] > highestScore) {
                  highestScore = highestScorePlayoff[manager.managerId][leagueId];
                  highestScoreWeek = highestScorePlayoffWeek[manager.managerId][leagueId];
                }
                if (lowestScorePlayoff[manager.managerId][leagueId] < lowestScore) {
                  lowestScore = lowestScorePlayoff[manager.managerId][leagueId];
                  lowestScoreWeek = lowestScorePlayoffWeek[manager.managerId][leagueId];
                }
                pointsForward += pointsForwardPlayoff[manager.managerId][leagueId];
                pointsAgainst += pointsAgainstPlayoff[manager.managerId][leagueId];
                numGames += numGamesPlayoff[manager.managerId][leagueId];
              }
            } else {
              // Aggregate across all years
              for (const league of ld.years) {
                if (scope !== "postseason") {
                  // Regular season scope
                  if (highestScoreRegular[manager.managerId][league.leagueId] > highestScore) {
                    highestScore = highestScoreRegular[manager.managerId][league.leagueId];
                    highestScoreWeek = highestScoreRegularWeek[manager.managerId][league.leagueId];
                  }
                  if (lowestScoreRegular[manager.managerId][league.leagueId] < lowestScore) {
                    lowestScore = lowestScoreRegular[manager.managerId][league.leagueId];
                    lowestScoreWeek = lowestScoreRegularWeek[manager.managerId][league.leagueId];
                  }
                  pointsForward += pointsForwardRegular[manager.managerId][league.leagueId];
                  pointsAgainst += pointsAgainstRegular[manager.managerId][league.leagueId];
                  numGames += numGamesRegular[manager.managerId][league.leagueId];
                }
                if (scope !== "in-season") {
                  // Postseason scope
                  if (highestScorePlayoff[manager.managerId][league.leagueId] > highestScore) {
                    highestScore = highestScorePlayoff[manager.managerId][league.leagueId];
                    highestScoreWeek = highestScorePlayoffWeek[manager.managerId][league.leagueId];
                  }
                  if (lowestScorePlayoff[manager.managerId][league.leagueId] < lowestScore) {
                    lowestScore = lowestScorePlayoff[manager.managerId][league.leagueId];
                    lowestScoreWeek = lowestScorePlayoffWeek[manager.managerId][league.leagueId];
                  }
                  pointsForward += pointsForwardPlayoff[manager.managerId][league.leagueId];
                  pointsAgainst += pointsAgainstPlayoff[manager.managerId][league.leagueId];
                  numGames += numGamesPlayoff[manager.managerId][league.leagueId];
                }
              }
            }

            if (numGames > 0) {
              records.push({
                key:
                  manager.managerId + (leagueId ? `-${leagueId}` : "") + (scope ? `-${scope}` : ""),
                manager: manager.name,
                highestScore,
                highestScoreWeek,
                lowestScore,
                lowestScoreWeek,
                pointsForward,
                pointsAgainst,
                numGames,
                pointsForwardPerGame: pointsForward / numGames,
                pointsAgainstPerGame: pointsAgainst / numGames,
                scope,
                league: leagueId,
              });
            }
          }
        }

        return records;
      })
      .sort((a, b) => {
        const aVal =
          sortBy === "high-score"
            ? a.highestScore
            : sortBy === "low-score"
              ? -a.lowestScore
              : sortBy === "points-forward"
                ? a.pointsForward
                : sortBy === "points-forward-per-game"
                  ? a.pointsForwardPerGame
                  : sortBy === "points-against-per-game"
                    ? a.pointsAgainstPerGame
                    : a.pointsAgainst;
        const bVal =
          sortBy === "high-score"
            ? b.highestScore
            : sortBy === "low-score"
              ? -b.lowestScore
              : sortBy === "points-forward"
                ? b.pointsForward
                : sortBy === "points-forward-per-game"
                  ? b.pointsForwardPerGame
                  : sortBy === "points-against-per-game"
                    ? b.pointsAgainstPerGame
                    : b.pointsAgainst;
        return bVal - aVal;
      });

    return {
      type: "record",
      category: rd.category,
      name: rd.name,
      displayAll: rd.displayAll,
      dataAvailableFromYear,
      columns: [
        {
          key: "manager",
          title: "Manager",
          type: "string",
        },
        {
          key: "highestScore",
          hintKey: "highestScoreWeek",
          title: "Highest Score",
          type: "number",
          decimalPrecision: 2,
        },
        {
          key: "lowestScore",
          hintKey: "lowestScoreWeek",
          title: "Lowest Score",
          type: "number",
          decimalPrecision: 2,
        },
        {
          key: "pointsForward",
          title: "PF",
          type: "number",
          decimalPrecision: 2,
        },
        {
          key: "pointsAgainst",
          title: "PA",
          type: "number",
          decimalPrecision: 2,
        },
        {
          key: "numGames",
          title: "G",
          type: "number",
        },
        {
          key: "pointsForwardPerGame",
          title: "PFPG",
          type: "number",
          decimalPrecision: 2,
        },
        {
          key: "pointsAgainstPerGame",
          title: "PAPG",
          type: "number",
          decimalPrecision: 2,
        },
      ],
      keyField: "key",
      entries,
    };
  };
}
