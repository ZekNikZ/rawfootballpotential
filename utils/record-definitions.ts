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
                  scope: (matchup.week < league.matchupData.playoffWeekStart
                    ? "in-season"
                    : "playoffs") as RecordScope,
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
                  scope: (matchup.week < league.matchupData.playoffWeekStart
                    ? "in-season"
                    : "playoffs") as RecordScope,
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
                scope: (matchup.week < league.matchupData.playoffWeekStart
                  ? "in-season"
                  : "playoffs") as RecordScope,
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
              scope: (matchup.week < league.matchupData.playoffWeekStart
                ? "in-season"
                : "playoffs") as RecordScope,
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
                scope: (matchup.week < league.matchupData.playoffWeekStart
                  ? "in-season"
                  : "playoffs") as RecordScope,
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
              scope: (matchup.week < league.matchupData.playoffWeekStart
                ? "in-season"
                : "playoffs") as RecordScope,
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
    longestWinStreakYear: number;
    longestLossStreak: number;
    longestLossStreakYear: number;
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

    const totalSeasonWins: Record<ManagerId, number> = {};
    const totalSeasonLosses: Record<ManagerId, number> = {};
    const totalPlayoffWins: Record<ManagerId, number> = {};
    const totalPlayoffLosses: Record<ManagerId, number> = {};
    const yearsInLeague: Record<ManagerId, number[]> = {};
    const longestSeasonWinStreaks: Record<ManagerId, { streak: number; year: number }> = {};
    const longestSeasonLossStreaks: Record<ManagerId, { streak: number; year: number }> = {};
    const longestPlayoffWinStreaks: Record<ManagerId, { streak: number; year: number }> = {};
    const longestPlayoffLossStreaks: Record<ManagerId, { streak: number; year: number }> = {};
    const longestTotalWinStreaks: Record<ManagerId, { streak: number; year: number }> = {};
    const longestTotalLossStreaks: Record<ManagerId, { streak: number; year: number }> = {};
    let currentSeasonStreaks: Record<ManagerId, { streak: number; type: "W" | "L" }>;
    let currentPlayoffStreaks: Record<ManagerId, { streak: number; type: "W" | "L" }>;
    let currentTotalStreaks: Record<ManagerId, { streak: number; type: "W" | "L" }>;

    ld.years
      .map((league) => leagues[league.leagueId])
      .forEach((league) => {
        currentSeasonStreaks = {};
        currentPlayoffStreaks = {};
        currentTotalStreaks = {};

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

          // Count wins and losses
          if (!isPlayoff) {
            if (!totalSeasonWins[winner]) {
              totalSeasonWins[winner] = 0;
            }
            totalSeasonWins[winner] += 1;
          } else {
            if (!totalPlayoffWins[winner]) {
              totalPlayoffWins[winner] = 0;
            }
            totalPlayoffWins[winner] += 1;
          }

          if (!isPlayoff) {
            if (!totalSeasonLosses[loser]) {
              totalSeasonLosses[loser] = 0;
            }
            totalSeasonLosses[loser] += 1;
          } else {
            if (!totalPlayoffLosses[loser]) {
              totalPlayoffLosses[loser] = 0;
            }
            totalPlayoffLosses[loser] += 1;
          }

          // Count years in league
          const winnerYears = yearsInLeague[winner] ?? [];
          const loserYears = yearsInLeague[loser] ?? [];
          yearsInLeague[winner] = _.uniq([...winnerYears, league.year]);
          yearsInLeague[loser] = _.uniq([...loserYears, league.year]);

          // Streaks
          if (!currentTotalStreaks[winner]) {
            currentTotalStreaks[winner] = { streak: 1, type: "W" };
          } else {
            if (currentTotalStreaks[winner].type === "W") {
              currentTotalStreaks[winner].streak += 1;
            } else {
              if (
                currentTotalStreaks[winner].streak > (longestTotalLossStreaks[winner]?.streak ?? 0)
              ) {
                longestTotalLossStreaks[winner] = {
                  streak: currentTotalStreaks[winner].streak,
                  year: league.year,
                };
              }
              currentTotalStreaks[winner] = { streak: 1, type: "W" };
            }
          }
          if (!isPlayoff) {
            if (!currentSeasonStreaks[winner]) {
              currentSeasonStreaks[winner] = { streak: 1, type: "W" };
            } else {
              if (currentSeasonStreaks[winner].type === "W") {
                currentSeasonStreaks[winner].streak += 1;
              } else {
                if (
                  currentSeasonStreaks[winner].streak >
                  (longestSeasonLossStreaks[winner]?.streak ?? 0)
                ) {
                  longestSeasonLossStreaks[winner] = {
                    streak: currentSeasonStreaks[winner].streak,
                    year: league.year,
                  };
                }
                currentSeasonStreaks[winner] = { streak: 1, type: "W" };
              }
            }
          } else {
            if (!currentPlayoffStreaks[winner]) {
              currentPlayoffStreaks[winner] = { streak: 1, type: "W" };
            } else {
              if (currentPlayoffStreaks[winner].type === "W") {
                currentPlayoffStreaks[winner].streak += 1;
              } else {
                if (
                  currentPlayoffStreaks[winner].streak >
                  (longestPlayoffLossStreaks[winner]?.streak ?? 0)
                ) {
                  longestPlayoffLossStreaks[winner] = {
                    streak: currentPlayoffStreaks[winner].streak,
                    year: league.year,
                  };
                }
                currentPlayoffStreaks[winner] = { streak: 1, type: "W" };
              }
            }
          }

          if (!currentTotalStreaks[loser]) {
            currentTotalStreaks[loser] = { streak: 1, type: "L" };
          } else {
            if (currentTotalStreaks[loser].type === "L") {
              currentTotalStreaks[loser].streak += 1;
            } else {
              if (
                currentTotalStreaks[loser].streak > (longestTotalWinStreaks[loser]?.streak ?? 0)
              ) {
                longestTotalWinStreaks[loser] = {
                  streak: currentTotalStreaks[loser].streak,
                  year: league.year,
                };
              }
              currentTotalStreaks[loser] = { streak: 1, type: "L" };
            }
          }
          if (!isPlayoff) {
            if (!currentSeasonStreaks[loser]) {
              currentSeasonStreaks[loser] = { streak: 1, type: "L" };
            } else {
              if (currentSeasonStreaks[loser].type === "L") {
                currentSeasonStreaks[loser].streak += 1;
              } else {
                if (
                  currentSeasonStreaks[loser].streak > (longestSeasonWinStreaks[loser]?.streak ?? 0)
                ) {
                  longestSeasonWinStreaks[loser] = {
                    streak: currentSeasonStreaks[loser].streak,
                    year: league.year,
                  };
                }
                currentSeasonStreaks[loser] = { streak: 1, type: "L" };
              }
            }
          } else {
            if (!currentPlayoffStreaks[loser]) {
              currentPlayoffStreaks[loser] = { streak: 1, type: "L" };
            } else {
              if (currentPlayoffStreaks[loser].type === "L") {
                currentPlayoffStreaks[loser].streak += 1;
              } else {
                if (
                  currentPlayoffStreaks[loser].streak >
                  (longestPlayoffWinStreaks[loser]?.streak ?? 0)
                ) {
                  longestPlayoffWinStreaks[loser] = {
                    streak: currentPlayoffStreaks[loser].streak,
                    year: league.year,
                  };
                }
                currentPlayoffStreaks[loser] = { streak: 1, type: "L" };
              }
            }
          }
        }

        for (const manager of Object.keys(currentTotalStreaks) as ManagerId[]) {
          // Total
          if (
            currentTotalStreaks[manager].type === "W" &&
            currentTotalStreaks[manager].streak > (longestTotalWinStreaks[manager]?.streak ?? 0)
          ) {
            longestTotalWinStreaks[manager] = {
              streak: currentTotalStreaks[manager].streak,
              year: league.year,
            };
          }
          if (
            currentTotalStreaks[manager].type === "L" &&
            currentTotalStreaks[manager].streak > (longestTotalLossStreaks[manager]?.streak ?? 0)
          ) {
            longestTotalLossStreaks[manager] = {
              streak: currentTotalStreaks[manager].streak,
              year: league.year,
            };
          }

          // Season
          if (
            currentSeasonStreaks[manager].type === "W" &&
            currentSeasonStreaks[manager].streak > (longestSeasonWinStreaks[manager]?.streak ?? 0)
          ) {
            longestSeasonWinStreaks[manager] = {
              streak: currentSeasonStreaks[manager].streak,
              year: league.year,
            };
          }
          if (
            currentSeasonStreaks[manager].type === "L" &&
            currentSeasonStreaks[manager].streak > (longestSeasonLossStreaks[manager]?.streak ?? 0)
          ) {
            longestSeasonLossStreaks[manager] = {
              streak: currentSeasonStreaks[manager].streak,
              year: league.year,
            };
          }

          // Playoff
          if (
            currentPlayoffStreaks[manager] &&
            currentPlayoffStreaks[manager].type === "W" &&
            currentPlayoffStreaks[manager].streak > (longestPlayoffWinStreaks[manager]?.streak ?? 0)
          ) {
            longestPlayoffWinStreaks[manager] = {
              streak: currentPlayoffStreaks[manager].streak,
              year: league.year,
            };
          }
          if (
            currentPlayoffStreaks[manager] &&
            currentPlayoffStreaks[manager].type === "L" &&
            currentPlayoffStreaks[manager].streak >
              (longestPlayoffLossStreaks[manager]?.streak ?? 0)
          ) {
            longestPlayoffLossStreaks[manager] = {
              streak: currentPlayoffStreaks[manager].streak,
              year: league.year,
            };
          }
        }
      });

    const entries = managers
      .flatMap<RecordEntry>((manager) => {
        const seasonWins = totalSeasonWins[manager.managerId] ?? 0;
        const playoffWins = totalPlayoffWins[manager.managerId] ?? 0;
        const seasonLosses = totalSeasonLosses[manager.managerId] ?? 0;
        const playoffLosses = totalPlayoffLosses[manager.managerId] ?? 0;
        const yearsInLeagueForManager = (yearsInLeague[manager.managerId] ?? []).length;

        return [
          {
            key: manager.managerId,
            manager: manager.name,
            wins: seasonWins + playoffWins,
            losses: seasonLosses + playoffLosses,
            yearsInLeague: yearsInLeagueForManager,
            winPercentage:
              (seasonWins + playoffWins) /
              (seasonWins + playoffWins + seasonLosses + playoffLosses),
            longestWinStreak: longestTotalWinStreaks[manager.managerId]?.streak,
            longestWinStreakYear: longestTotalWinStreaks[manager.managerId]?.year,
            longestLossStreak: longestTotalLossStreaks[manager.managerId]?.streak,
            longestLossStreakYear: longestTotalLossStreaks[manager.managerId]?.year,
          },
          {
            key: manager.managerId,
            manager: manager.name,
            wins: seasonWins,
            losses: seasonLosses,
            yearsInLeague: yearsInLeagueForManager,
            winPercentage: seasonWins / (seasonWins + seasonLosses),
            longestWinStreak: longestSeasonWinStreaks[manager.managerId]?.streak,
            longestWinStreakYear: longestSeasonWinStreaks[manager.managerId]?.year,
            longestLossStreak: longestSeasonLossStreaks[manager.managerId]?.streak,
            longestLossStreakYear: longestSeasonLossStreaks[manager.managerId]?.year,
            scope: "in-season",
          },
          {
            key: manager.managerId,
            manager: manager.name,
            wins: playoffWins,
            losses: playoffLosses,
            yearsInLeague: yearsInLeagueForManager,
            winPercentage: playoffWins / (playoffWins + playoffLosses),
            longestWinStreak: longestPlayoffWinStreaks[manager.managerId]?.streak,
            longestWinStreakYear: longestPlayoffWinStreaks[manager.managerId]?.year,
            longestLossStreak: longestPlayoffLossStreaks[manager.managerId]?.streak,
            longestLossStreakYear: longestPlayoffLossStreaks[manager.managerId]?.year,
            scope: "playoffs",
          },
        ];
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
          key: "yearsInLeague",
          title: "YiL",
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
          hintKey: "longestWinStreakYear",
          title: "Longest Win Streak",
          type: "number",
        },
        {
          key: "longestLossStreak",
          hintKey: "longestLossStreakYear",
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

    const perfectLineupsRegular: Record<ManagerId, number> = {};
    const perfectLineupsPlayoff: Record<ManagerId, number> = {};
    const potentialPointsRegular: Record<ManagerId, number> = {};
    const potentialPointsPlayoff: Record<ManagerId, number> = {};
    const realizedPointsRegular: Record<ManagerId, number> = {};
    const realizedPointsPlayoff: Record<ManagerId, number> = {};

    ld.years
      .map((league) => leagues[league.leagueId])
      .forEach((league) => {
        for (const matchup of league.matchupData.matchups.sort((a, b) => a.week - b.week)) {
          const isPlayoff = matchup.week >= league.matchupData.playoffWeekStart;

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
              realizedPointsRegular[managerId] =
                (realizedPointsRegular[managerId] ?? 0) + actualScore;
              potentialPointsRegular[managerId] =
                (potentialPointsRegular[managerId] ?? 0) + potentialScore;
              if (actualScore / potentialScore > 0.999) {
                perfectLineupsRegular[managerId] = (perfectLineupsRegular[managerId] ?? 0) + 1;
              }
            } else {
              realizedPointsPlayoff[managerId] =
                (realizedPointsPlayoff[managerId] ?? 0) + actualScore;
              potentialPointsPlayoff[managerId] =
                (potentialPointsPlayoff[managerId] ?? 0) + potentialScore;
              if (actualScore / potentialScore > 0.999) {
                perfectLineupsPlayoff[managerId] = (perfectLineupsPlayoff[managerId] ?? 0) + 1;
              }
            }
          }

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
              realizedPointsRegular[managerId] =
                (realizedPointsRegular[managerId] ?? 0) + actualScore;
              potentialPointsRegular[managerId] =
                (potentialPointsRegular[managerId] ?? 0) + potentialScore;
              if (actualScore / potentialScore > 0.999) {
                perfectLineupsRegular[managerId] = (perfectLineupsRegular[managerId] ?? 0) + 1;
              }
            } else {
              realizedPointsPlayoff[managerId] =
                (realizedPointsPlayoff[managerId] ?? 0) + actualScore;
              potentialPointsPlayoff[managerId] =
                (potentialPointsPlayoff[managerId] ?? 0) + potentialScore;
              if (actualScore / potentialScore > 0.999) {
                perfectLineupsPlayoff[managerId] = (perfectLineupsPlayoff[managerId] ?? 0) + 1;
              }
            }
          }
        }
      });

    const managers = _.uniqBy(
      ld.years
        .map((league) => leagues[league.leagueId])
        .flatMap((league) => Object.values(league.mangerData.managers)),
      (el) => el.managerId
    );

    const entries = (Object.keys(realizedPointsPlayoff) as ManagerId[])
      .flatMap<RecordEntry>((managerId) => {
        const manager = managers.find((m) => m.managerId == managerId)!;

        const seasonPerfectLineups = perfectLineupsRegular[managerId] ?? 0;
        const playoffPerfectLineups = perfectLineupsPlayoff[managerId] ?? 0;
        const seasonActualPoints = realizedPointsRegular[managerId] ?? 0;
        const playoffActualPoints = realizedPointsPlayoff[managerId] ?? 0;
        const seasonPotentialPoints = potentialPointsRegular[managerId] ?? 0;
        const playoffPotentialPoints = potentialPointsPlayoff[managerId] ?? 0;

        return [
          {
            key: manager.managerId,
            manager: manager.name,
            perfectLineups: seasonPerfectLineups + playoffPerfectLineups,
            missedPoints:
              seasonPotentialPoints +
              playoffPotentialPoints -
              (seasonActualPoints + playoffActualPoints),
            lineupIQ:
              (seasonActualPoints + playoffActualPoints) /
              (seasonPotentialPoints + playoffPotentialPoints),
          },
          {
            key: manager.managerId,
            manager: manager.name,
            perfectLineups: seasonPerfectLineups,
            missedPoints: seasonPotentialPoints - seasonActualPoints,
            lineupIQ: seasonActualPoints / seasonPotentialPoints,
            scope: "in-season",
          },
          {
            key: manager.managerId,
            manager: manager.name,
            perfectLineups: playoffPerfectLineups,
            missedPoints: playoffPotentialPoints - playoffActualPoints,
            lineupIQ: playoffActualPoints / playoffPotentialPoints,
            scope: "playoffs",
          },
        ];
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

    const highestScoreRegular: Record<ManagerId, number> = {};
    const highestScorePlayoff: Record<ManagerId, number> = {};
    const lowestScoreRegular: Record<ManagerId, number> = {};
    const lowestScorePlayoff: Record<ManagerId, number> = {};

    const highestScoreRegularWeek: Record<ManagerId, string> = {};
    const highestScorePlayoffWeek: Record<ManagerId, string> = {};
    const lowestScoreRegularWeek: Record<ManagerId, string> = {};
    const lowestScorePlayoffWeek: Record<ManagerId, string> = {};

    const pointsForwardRegular: Record<ManagerId, number> = {};
    const pointsForwardPlayoff: Record<ManagerId, number> = {};
    const pointsAgainstRegular: Record<ManagerId, number> = {};
    const pointsAgainstPlayoff: Record<ManagerId, number> = {};

    const numGamesRegular: Record<ManagerId, number> = {};
    const numGamesPlayoff: Record<ManagerId, number> = {};

    ld.years
      .map((league) => leagues[league.leagueId])
      .forEach((league) => {
        for (const matchup of league.matchupData.matchups.sort((a, b) => a.week - b.week)) {
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
            if (matchup.team1.points > (highestScoreRegular[manager1Id] ?? 0)) {
              highestScoreRegular[manager1Id] = matchup.team1.points;
              highestScoreRegularWeek[manager1Id] = `${league.year} WK ${matchup.week}`;
            }
            if (matchup.team2.points > (highestScoreRegular[manager2Id] ?? 0)) {
              highestScoreRegular[manager2Id] = matchup.team2.points;
              highestScoreRegularWeek[manager2Id] = `${league.year} WK ${matchup.week}`;
            }

            if (matchup.team1.points < (lowestScoreRegular[manager1Id] ?? 999)) {
              lowestScoreRegular[manager1Id] = matchup.team1.points;
              lowestScoreRegularWeek[manager1Id] = `${league.year} WK ${matchup.week}`;
            }
            if (matchup.team2.points < (lowestScoreRegular[manager2Id] ?? 999)) {
              lowestScoreRegular[manager2Id] = matchup.team2.points;
              lowestScoreRegularWeek[manager2Id] = `${league.year} WK ${matchup.week}`;
            }

            pointsForwardRegular[manager1Id] =
              (pointsForwardRegular[manager1Id] ?? 0) + matchup.team1.points;
            pointsForwardRegular[manager2Id] =
              (pointsForwardRegular[manager2Id] ?? 0) + matchup.team2.points;

            pointsAgainstRegular[manager1Id] =
              (pointsAgainstRegular[manager1Id] ?? 0) + matchup.team2.points;
            pointsAgainstRegular[manager2Id] =
              (pointsAgainstRegular[manager2Id] ?? 0) + matchup.team1.points;

            numGamesRegular[manager1Id] = (numGamesRegular[manager1Id] ?? 0) + 1;
            numGamesRegular[manager2Id] = (numGamesRegular[manager2Id] ?? 0) + 1;
          } else {
            if (matchup.team1.points > (highestScorePlayoff[manager1Id] ?? 0)) {
              highestScorePlayoff[manager1Id] = matchup.team1.points;
              highestScorePlayoffWeek[manager1Id] = `${league.year} WK ${matchup.week}`;
            }
            if (matchup.team2.points > (highestScorePlayoff[manager2Id] ?? 0)) {
              highestScorePlayoff[manager2Id] = matchup.team2.points;
              highestScorePlayoffWeek[manager2Id] = `${league.year} WK ${matchup.week}`;
            }

            if (matchup.team1.points < (lowestScorePlayoff[manager1Id] ?? 999)) {
              lowestScorePlayoff[manager1Id] = matchup.team1.points;
              lowestScorePlayoffWeek[manager1Id] = `${league.year} WK ${matchup.week}`;
            }
            if (matchup.team2.points < (lowestScorePlayoff[manager2Id] ?? 999)) {
              lowestScorePlayoff[manager2Id] = matchup.team2.points;
              lowestScorePlayoffWeek[manager2Id] = `${league.year} WK ${matchup.week}`;
            }

            pointsForwardPlayoff[manager1Id] =
              (pointsForwardPlayoff[manager1Id] ?? 0) + matchup.team1.points;
            pointsForwardPlayoff[manager2Id] =
              (pointsForwardPlayoff[manager2Id] ?? 0) + matchup.team2.points;

            pointsAgainstPlayoff[manager1Id] =
              (pointsAgainstPlayoff[manager1Id] ?? 0) + matchup.team2.points;
            pointsAgainstPlayoff[manager2Id] =
              (pointsAgainstPlayoff[manager2Id] ?? 0) + matchup.team1.points;

            numGamesPlayoff[manager1Id] = (numGamesPlayoff[manager1Id] ?? 0) + 1;
            numGamesPlayoff[manager2Id] = (numGamesPlayoff[manager2Id] ?? 0) + 1;
          }
        }
      });

    const managers = _.uniqBy(
      ld.years
        .map((league) => leagues[league.leagueId])
        .flatMap((league) => Object.values(league.mangerData.managers)),
      (el) => el.managerId
    );

    const entries = managers
      .flatMap<RecordEntry>((manager) => {
        const highestScoreRegulars = highestScoreRegular[manager.managerId];
        const highestScoreRegularsWeek = highestScoreRegularWeek[manager.managerId];
        const highestScorePlayoffs = highestScorePlayoff[manager.managerId];
        const highestScorePlayoffsWeek = highestScorePlayoffWeek[manager.managerId];
        const lowestScoreRegulars = lowestScoreRegular[manager.managerId];
        const lowestScoreRegularsWeek = lowestScoreRegularWeek[manager.managerId];
        const lowestScorePlayoffs = lowestScorePlayoff[manager.managerId];
        const lowestScorePlayoffsWeek = lowestScorePlayoffWeek[manager.managerId];
        const pointsForwardRegulars = pointsForwardRegular[manager.managerId] ?? 0;
        const pointsForwardPlayoffs = pointsForwardPlayoff[manager.managerId] ?? 0;
        const pointsAgainstRegulars = pointsAgainstRegular[manager.managerId] ?? 0;
        const pointsAgainstPlayoffs = pointsAgainstPlayoff[manager.managerId] ?? 0;
        const numGamesRegulars = numGamesRegular[manager.managerId] ?? 0;
        const numGamesPlayoffs = numGamesPlayoff[manager.managerId] ?? 0;

        return [
          {
            key: manager.managerId,
            manager: manager.name,
            highestScore:
              highestScoreRegulars > (highestScorePlayoffs ?? 0)
                ? highestScoreRegulars
                : highestScorePlayoffs,
            highestScoreWeek:
              highestScoreRegulars > (highestScorePlayoffs ?? 0)
                ? highestScoreRegularsWeek
                : highestScorePlayoffsWeek,
            lowestScore:
              lowestScoreRegulars < (lowestScorePlayoffs ?? 999)
                ? lowestScoreRegulars
                : lowestScorePlayoffs,
            lowestScoreWeek:
              lowestScoreRegulars < (lowestScorePlayoffs ?? 999)
                ? lowestScoreRegularsWeek
                : lowestScorePlayoffsWeek,
            pointsForward: pointsForwardRegulars + pointsForwardPlayoffs,
            pointsAgainst: pointsAgainstRegulars + pointsAgainstPlayoffs,
            numGames: numGamesRegulars + numGamesPlayoffs,
            pointsForwardPerGame:
              (pointsForwardRegulars + pointsForwardPlayoffs) /
              (numGamesRegulars + numGamesPlayoffs),
            pointsAgainstPerGame:
              (pointsAgainstRegulars + pointsAgainstPlayoffs) /
              (numGamesRegulars + numGamesPlayoffs),
          },
          {
            key: manager.managerId,
            manager: manager.name,
            highestScore: highestScoreRegulars,
            highestScoreWeek: highestScoreRegularsWeek,
            lowestScore: lowestScoreRegulars,
            lowestScoreWeek: lowestScoreRegularsWeek,
            pointsForward: pointsForwardRegulars,
            pointsAgainst: pointsAgainstRegulars,
            numGames: numGamesRegulars,
            pointsForwardPerGame: pointsForwardRegulars / numGamesRegulars,
            pointsAgainstPerGame: pointsAgainstRegulars / numGamesRegulars,
            scope: "in-season",
          },
          {
            key: manager.managerId,
            manager: manager.name,
            highestScore: highestScorePlayoffs,
            highestScoreWeek: highestScorePlayoffsWeek,
            lowestScore: lowestScorePlayoffs,
            lowestScoreWeek: lowestScorePlayoffsWeek,
            pointsForward: pointsForwardPlayoffs,
            pointsAgainst: pointsAgainstPlayoffs,
            numGames: numGamesPlayoffs,
            pointsForwardPerGame: pointsForwardPlayoffs / numGamesPlayoffs,
            pointsAgainstPerGame: pointsAgainstPlayoffs / numGamesPlayoffs,
            scope: "playoffs",
          },
        ];
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
