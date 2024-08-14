import formatter from "format-number";
import {
  BaseRecordEntry,
  FantasyRecord,
  League,
  LeagueDefinition,
  LeagueId,
  RecordCategoryDefinition,
  RecordDefinition,
  RecordScope,
  Team,
} from "../types";
import _ from "lodash";

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
        name: "Single week highest score",
        generateRecord: weeklyScoreRecord("score", "highest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Single week lowest score",
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
        name: "Single week highest teamwide score",
        generateRecord: weeklyTeamwideScoreRecord("total", "highest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Single week lowest teamwide score",
        generateRecord: weeklyTeamwideScoreRecord("total", "lowest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Single week highest bench score",
        generateRecord: weeklyTeamwideScoreRecord("bench", "highest"),
      },
      {
        type: "record",
        category: "overall",
        name: "Single week lowest bench score",
        generateRecord: weeklyTeamwideScoreRecord("bench", "lowest"),
      },
    ],
  },
];

function weeklyScoreRecord(sortBy: "score" | "differential", sortOrder: "highest" | "lowest") {
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
            sortBy !== "differential" || scoreDelta > 0
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
            sortBy !== "differential" || scoreDelta < 0
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
        const aVal = sortBy === "score" ? a.score : a.scoreDelta;
        const bVal = sortBy === "score" ? b.score : b.scoreDelta;
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
