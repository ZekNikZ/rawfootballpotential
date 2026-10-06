import _ from "lodash";
import { League, LeagueDefinition, ManagerId, ManagerMatchupData } from "../types";

export function computeManagerMatchups(
  leagueDefinition: LeagueDefinition,
  leagues: Record<string, League>
): ManagerMatchupData {
  const managers = _.uniqBy(
    leagueDefinition.years
      .map((league) => leagues[league.leagueId])
      .flatMap((league) => Object.values(league.managerData.managers)),
    (el) => el.managerId
  );

  // Initialize manager matchups
  function initMap(): ManagerMatchupData["data"] {
    const map: ManagerMatchupData["data"] = {};
    for (const manager of managers) {
      map[manager.managerId] = {
        MEDIAN: { wins: 0, count: 0 },
      };
      for (const opponent of managers) {
        map[manager.managerId][opponent.managerId] = { wins: 0, count: 0 };
      }
    }
    return map;
  }

  const managerMatchups = initMap();

  let dataAvailableFromYear = 9999;

  leagueDefinition.years
    .map((league) => leagues[league.leagueId])
    .forEach((year) => {
      if (year.year < dataAvailableFromYear) {
        dataAvailableFromYear = year.year;
      }

      // Compute medians
      const scoresPerWeek: Record<number, number[]> = {};
      for (const matchup of year.matchupData.matchups) {
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
      for (const matchup of year.matchupData.matchups.sort((a, b) => a.week - b.week)) {
        const isPlayoff = matchup.week >= year.matchupData.playoffWeekStart;

        // Handle medians
        const team1Id = matchup.team1.teamId;
        const team2Id =
          matchup.team2 !== "BYE" && matchup.team2 !== "TBD" ? matchup.team2.teamId : undefined;
        const team1 = Object.keys(year.managerData.teamAssignments).find(
          (managerId) => year.managerData.teamAssignments[managerId as ManagerId] === team1Id
        ) as ManagerId;
        const team2 = Object.keys(year.managerData.teamAssignments).find(
          (managerId) => year.managerData.teamAssignments[managerId as ManagerId] === team2Id
        ) as ManagerId;

        // Count median wins and losses
        if (!isPlayoff) {
          managerMatchups[team1]["MEDIAN"].count += 1;
          if (matchup.team1.points >= mediansPerWeek[matchup.week]) {
            managerMatchups[team1]["MEDIAN"].wins += 1;
          }
          if (matchup.team2 !== "BYE" && matchup.team2 !== "TBD") {
            managerMatchups[team2]["MEDIAN"].count += 1;
            if (matchup.team2.points >= mediansPerWeek[matchup.week]) {
              managerMatchups[team2]["MEDIAN"].wins += 1;
            }
          }
        }

        if (matchup.team2 === "BYE" || matchup.team2 === "TBD") {
          continue;
        }

        // Determine winner and loser
        const didTeam1Win = matchup.team1.points > matchup.team2.points;
        const winnerTeamId = didTeam1Win ? matchup.team1.teamId : matchup.team2.teamId;
        const loserTeamId = didTeam1Win ? matchup.team2.teamId : matchup.team1.teamId;

        // Get manager IDs of winner and loser
        const winner = Object.keys(year.managerData.teamAssignments).find(
          (managerId) => year.managerData.teamAssignments[managerId as ManagerId] === winnerTeamId
        ) as ManagerId;
        const loser = Object.keys(year.managerData.teamAssignments).find(
          (managerId) => year.managerData.teamAssignments[managerId as ManagerId] === loserTeamId
        ) as ManagerId;

        // Count wins and losses
        managerMatchups[winner][loser].count += 1;
        managerMatchups[loser][winner].count += 1;
        managerMatchups[winner][loser].wins += 1;
      }
    });

  return {
    dataAvailableFromYear,
    data: managerMatchups,
  };
}
