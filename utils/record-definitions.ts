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
        category: "overall",
        name: "Most wins (regular season + postseason)",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("win", true),
      },
      {
        type: "record",
        category: "overall",
        name: "Most losses (regular season + postseason)",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("loss", true),
      },
      {
        type: "record",
        category: "overall",
        name: "Highest win percentage (regular season + postseason)",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("win%", true),
      },
      {
        type: "record",
        category: "overall",
        name: "Most wins (regular season only)",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("win", false),
      },
      {
        type: "record",
        category: "overall",
        name: "Most losses (regular season only)",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("loss", false),
      },
      {
        type: "record",
        category: "overall",
        name: "Highest win percentage (regular season only)",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("win%", false),
      },
      {
        type: "record",
        category: "overall",
        name: "Highest win streak (regular season + postseason)",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("win-streak", false),
      },
      {
        type: "record",
        category: "overall",
        name: "Highest loss streak (regular season + postseason)",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("loss-streak", false),
      },
      {
        type: "record",
        category: "overall",
        name: "Highest win streak (regular season only)",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("win-streak", false),
      },
      {
        type: "record",
        category: "overall",
        name: "Highest loss streak (regular season only)",
        displayAll: true,
        generateRecord: managerCareerStandingsRecord("loss-streak", false),
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
                league.teamData.rosterPositions,
                matchup.team2.points > 140.55 && matchup.team2.points < 140.57
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
              league.teamData.rosterPositions,
              matchup.team1.points > 140.55 && matchup.team1.points < 140.57
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
  sortBy: "win" | "loss" | "win%" | "win-streak" | "loss-streak",
  includePlayoffs: boolean
) {
  interface RecordEntry extends BaseRecordEntry {
    key: string;
    manager: string;
    wins: number;
    losses: number;
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

    const totalWins: Record<ManagerId, number> = {};
    const totalLosses: Record<ManagerId, number> = {};
    const longestWinStreaks: Record<ManagerId, { streak: number; year: number }> = {};
    const longestLossStreaks: Record<ManagerId, { streak: number; year: number }> = {};
    let currentStreaks: Record<ManagerId, { streak: number; type: "W" | "L" }>;

    ld.years
      .map((league) => leagues[league.leagueId])
      .forEach((league) => {
        currentStreaks = {};

        for (const matchup of league.matchupData.matchups.sort((a, b) => a.week - b.week)) {
          if (matchup.team2 === "BYE" || matchup.team2 === "TBD") {
            continue;
          }

          if (!includePlayoffs && matchup.week >= league.matchupData.playoffWeekStart) {
            continue;
          }

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
          if (!totalWins[winner]) {
            totalWins[winner] = 0;
          }
          totalWins[winner] += 1;

          if (!totalLosses[loser]) {
            totalLosses[loser] = 0;
          }
          totalLosses[loser] += 1;

          // Streaks
          if (!currentStreaks[winner]) {
            currentStreaks[winner] = { streak: 1, type: "W" };
          } else {
            if (currentStreaks[winner].type === "W") {
              currentStreaks[winner].streak += 1;
            } else {
              if (currentStreaks[winner].streak > (longestLossStreaks[winner]?.streak ?? 0)) {
                longestLossStreaks[winner] = {
                  streak: currentStreaks[winner].streak,
                  year: league.year,
                };
              }
              currentStreaks[winner] = { streak: 1, type: "W" };
            }
          }

          if (!currentStreaks[loser]) {
            currentStreaks[loser] = { streak: 1, type: "L" };
          } else {
            if (currentStreaks[loser].type === "L") {
              currentStreaks[loser].streak += 1;
            } else {
              if (currentStreaks[loser].streak > (longestWinStreaks[loser]?.streak ?? 0)) {
                longestWinStreaks[loser] = {
                  streak: currentStreaks[loser].streak,
                  year: league.year,
                };
              }
              currentStreaks[loser] = { streak: 1, type: "L" };
            }
          }
        }

        for (const manager of Object.keys(currentStreaks) as ManagerId[]) {
          if (
            currentStreaks[manager].type === "W" &&
            currentStreaks[manager].streak > (longestWinStreaks[manager]?.streak ?? 0)
          ) {
            longestWinStreaks[manager] = {
              streak: currentStreaks[manager].streak,
              year: league.year,
            };
          }
          if (
            currentStreaks[manager].type === "L" &&
            currentStreaks[manager].streak > (longestLossStreaks[manager]?.streak ?? 0)
          ) {
            longestLossStreaks[manager] = {
              streak: currentStreaks[manager].streak,
              year: league.year,
            };
          }
        }
      });

    const entries: RecordEntry[] = managers
      .map((manager) => {
        const wins = totalWins[manager.managerId];
        const losses = totalLosses[manager.managerId];
        const longestWinStreak = longestWinStreaks[manager.managerId];
        const longestLossStreak = longestLossStreaks[manager.managerId];

        return {
          key: manager.managerId,
          manager: manager.name,
          wins,
          losses,
          winPercentage: wins / (wins + losses),
          longestWinStreak: longestWinStreak.streak,
          longestWinStreakYear: longestWinStreak.year,
          longestLossStreak: longestLossStreak.streak,
          longestLossStreakYear: longestLossStreak.year,
        };
      })
      .sort((a, b) => {
        const aVal =
          sortBy === "win"
            ? a.wins
            : sortBy === "loss"
              ? a.losses
              : sortBy === "win-streak"
                ? a.longestWinStreak
                : sortBy === "loss-streak"
                  ? a.longestLossStreak
                  : a.winPercentage;
        const bVal =
          sortBy === "win"
            ? b.wins
            : sortBy === "loss"
              ? b.losses
              : sortBy === "win-streak"
                ? b.longestWinStreak
                : sortBy === "loss-streak"
                  ? b.longestLossStreak
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
