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
} from "../types";

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
