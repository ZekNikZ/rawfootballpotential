import _ from "lodash";
import { League, LeagueDefinition, ManagerId, NFLData, TeamId, Trophy, TrophyData } from "../types";
import { optimizeScore } from "./positions";
import { typedEntries, typedFromEntries } from "./node";

const HIGH_SCORER_THRESHOLDS: Record<League["leagueType"], number> = {
  dynasty: 200,
  redraft: 190,
};
const BENCHWARMER_THRESHOLDS: Record<League["leagueType"], number> = {
  dynasty: 90,
  redraft: 65,
};
const SMARTYPANTS_THRESHOLDS: Record<League["leagueType"], number> = {
  dynasty: 0.999,
  redraft: 0.999,
};

export function computeTrophies(
  leagueDefinition: LeagueDefinition,
  leagues: Record<string, League>,
  nflData: NFLData
): TrophyData {
  const trophies: Trophy[] = [];

  const managers = _.uniqBy(
    leagueDefinition.years
      .map((league) => leagues[league.leagueId])
      .flatMap((league) => Object.values(league.managerData.managers)),
    (el) => el.managerId
  );

  // Initialize manager matchups
  function initMap<T>(value: T): Record<ManagerId, T> {
    const map: Record<ManagerId, T> = {};
    for (const manager of managers) {
      map[manager.managerId] = value;
    }
    return map;
  }

  let dataAvailableFromYear = 9999;

  leagueDefinition.years
    .map((league) => leagues[league.leagueId])
    .forEach((year) => {
      if (year.year < dataAvailableFromYear) {
        dataAvailableFromYear = year.year;
      }

      // Initialize maps
      const pointsFor = initMap(0);
      const pointsAgainst = initMap(0);
      const matchupScores: {
        week: number;
        winnerId: ManagerId;
        winnerScore: number;
        loserId: ManagerId;
        loserScore: number;
        margin: number;
      }[] = [];
      const matchupLineupIQs: {
        week: number;
        managerId: ManagerId;
        realizedScore: number;
        potentialScore: number;
        lineupIQ: number;
      }[] = [];

      // Compute podium placement trophies
      const placements = year.teamData.finalPlacements;
      if (placements) {
        const placementArray = typedEntries(placements).sort((a, b) => a[1] - b[1]);

        // Reverse team assignments
        const reversedAssignments = typedFromEntries(
          typedEntries(year.managerData.teamAssignments).map(
            ([managerId, teamId]) => [teamId, managerId] as [TeamId, ManagerId]
          )
        );

        const podiumTrophies = placementArray.slice(0, 3).map(([rosterId, placement]) => ({
          trophyType: "placement" as const,
          year: year.year,
          managerId: reversedAssignments[rosterId],
          placement,
        }));

        const lastPlaceTrophy = placementArray.slice(-1).map(([rosterId, placement]) => ({
          trophyType: "placement" as const,
          year: year.year,
          managerId: reversedAssignments[rosterId],
          placement,
        }))[0];

        trophies.push(...podiumTrophies, lastPlaceTrophy);
      }

      // Process matchups
      for (const matchup of year.matchupData.matchups.sort((a, b) => a.week - b.week)) {
        if (matchup.team2 === "BYE" || matchup.team2 === "TBD") {
          continue;
        }

        // Determine winner and loser
        const didTeam1Win = matchup.team1.points > matchup.team2.points;
        const team1Id = matchup.team1.teamId;
        const team2Id = matchup.team2.teamId;
        const winnerTeamId = didTeam1Win ? matchup.team1.teamId : matchup.team2.teamId;
        const loserTeamId = didTeam1Win ? matchup.team2.teamId : matchup.team1.teamId;
        const winnerScore = didTeam1Win ? matchup.team1.points : matchup.team2.points;
        const loserScore = didTeam1Win ? matchup.team2.points : matchup.team1.points;

        // Get manager IDs of winner and loser
        const team1ManagerId = Object.keys(year.managerData.teamAssignments).find(
          (managerId) => year.managerData.teamAssignments[managerId as ManagerId] === team1Id
        ) as ManagerId;
        const team2ManagerId = Object.keys(year.managerData.teamAssignments).find(
          (managerId) => year.managerData.teamAssignments[managerId as ManagerId] === team2Id
        ) as ManagerId;
        const winnerManagerId = Object.keys(year.managerData.teamAssignments).find(
          (managerId) => year.managerData.teamAssignments[managerId as ManagerId] === winnerTeamId
        ) as ManagerId;
        const loserManagerId = Object.keys(year.managerData.teamAssignments).find(
          (managerId) => year.managerData.teamAssignments[managerId as ManagerId] === loserTeamId
        ) as ManagerId;

        // Processs lineup IQ
        if (matchup.team1.hasPlayerData) {
          const potentialScore = optimizeScore(
            matchup.team1.players
              .filter((p) => !!p)
              .concat(matchup.team1.bench)
              .concat(matchup.team1.injuryReserve),
            nflData.players,
            matchup.team1.playerPoints,
            year.teamData.rosterPositions
          );
          const actualScore = matchup.team1.points;

          // Overall trophy
          if (actualScore / potentialScore > SMARTYPANTS_THRESHOLDS[year.leagueType]) {
            trophies.push({
              trophyType: "overall-high-iq",
              year: year.year,
              managerId: team1ManagerId,
              note: `IQ: ${((actualScore / potentialScore) * 100).toFixed(2)}%`,
              week: matchup.week,
            });
          }

          // Matchup lineup IQ
          matchupLineupIQs.push({
            week: matchup.week,
            managerId: team1ManagerId,
            realizedScore: actualScore,
            potentialScore,
            lineupIQ: actualScore / potentialScore,
          });
        }
        if (matchup.team2.hasPlayerData) {
          const potentialScore = optimizeScore(
            matchup.team2.players
              .filter((p) => !!p)
              .concat(matchup.team2.bench)
              .concat(matchup.team2.injuryReserve),
            nflData.players,
            matchup.team2.playerPoints,
            year.teamData.rosterPositions
          );
          const actualScore = matchup.team2.points;

          // Overall trophy
          if (actualScore / potentialScore > SMARTYPANTS_THRESHOLDS[year.leagueType]) {
            trophies.push({
              trophyType: "overall-high-iq",
              year: year.year,
              managerId: team2ManagerId,
              note: `IQ: ${((actualScore / potentialScore) * 100).toFixed(2)}%`,
              week: matchup.week,
            });
          }

          // Matchup lineup IQ
          matchupLineupIQs.push({
            week: matchup.week,
            managerId: team2ManagerId,
            realizedScore: actualScore,
            potentialScore,
            lineupIQ: actualScore / potentialScore,
          });
        }

        // Process matchup scores
        matchupScores.push({
          week: matchup.week,
          winnerId: winnerManagerId,
          winnerScore,
          loserId: loserManagerId,
          loserScore,
          margin: Math.abs(matchup.team1.points - matchup.team2.points),
        });

        // Overall high score trophy
        if (winnerScore >= HIGH_SCORER_THRESHOLDS[year.leagueType]) {
          trophies.push({
            trophyType: "overall-high-score",
            year: year.year,
            managerId: winnerManagerId,
            note: `${winnerScore.toFixed(2)}pts (${winnerScore.toFixed(2)}-${loserScore.toFixed(2)} against ${loserManagerId})`,
            week: matchup.week,
          });
        }
        // Overall low score trophy
        if (loserScore < BENCHWARMER_THRESHOLDS[year.leagueType]) {
          trophies.push({
            trophyType: "overall-low-score",
            year: year.year,
            managerId: loserManagerId,
            note: `${loserScore.toFixed(2)}pts (${winnerScore.toFixed(2)}-${loserScore.toFixed(2)} against ${winnerManagerId})`,
            week: matchup.week,
          });
        }

        // Update points for and against
        pointsFor[winnerManagerId] += winnerScore;
        pointsAgainst[loserManagerId] += loserScore;
      }

      // Season high IQ trophy - max lineup IQ across all matchups, break ties by # of entries by manager ID, include all if tie
      const maxLineupIQ = Math.max(...matchupLineupIQs.map((entry) => entry.lineupIQ));
      const highIQEntries = matchupLineupIQs.filter(
        (entry) => Math.abs(entry.lineupIQ - maxLineupIQ) < 0.0001
      );
      if (highIQEntries.length === 1) {
        const { week, managerId, lineupIQ } = highIQEntries[0];
        trophies.push({
          trophyType: "season-high-iq",
          year: year.year,
          week,
          managerId,
          note: `IQ: ${(lineupIQ * 100).toFixed(2)}%`,
        });
      } else {
        const countsByManager = _.countBy(highIQEntries, (entry) => entry.managerId);
        const maxCount = Math.max(...Object.values(countsByManager));
        const winners = typedEntries(countsByManager)
          .filter(([, count]) => count === maxCount)
          .map(([managerId]) => managerId as ManagerId);
        for (const managerId of winners) {
          trophies.push({
            trophyType: "season-high-iq",
            year: year.year,
            managerId,
            note: `IQ: ${(maxLineupIQ * 100).toFixed(2)}% x${maxCount}`,
          });
        }
      }

      // Season high score trophy - max score across all matchups, include all if tie
      const maxScore = Math.max(...matchupScores.map((entry) => entry.winnerScore));
      const highScoreEntries = matchupScores.filter((entry) => entry.winnerScore === maxScore);
      for (const { week, winnerId, winnerScore, loserScore, loserId } of highScoreEntries) {
        trophies.push({
          trophyType: "season-high-score",
          year: year.year,
          week,
          managerId: winnerId,
          note: `${maxScore.toFixed(2)}pts (${winnerScore.toFixed(2)}-${loserScore.toFixed(2)} against ${loserId})`,
        });
      }

      // Season narrowest win trophy - min margin across all matchups, include all if tie
      const minMargin = Math.min(...matchupScores.map((entry) => entry.margin));
      const narrowestWinEntries = matchupScores.filter((entry) => entry.margin === minMargin);
      for (const { week, winnerId, winnerScore, loserScore, loserId } of narrowestWinEntries) {
        trophies.push({
          trophyType: "season-narrowest-win",
          year: year.year,
          week,
          managerId: winnerId,
          note: `${minMargin.toFixed(2)}pts (${winnerScore.toFixed(2)}-${loserScore.toFixed(2)} against ${loserId})`,
        });
      }

      // Season largest blowout trophy - max margin across all matchups, include all if tie
      const maxMargin = Math.max(...matchupScores.map((entry) => entry.margin));
      const blowoutEntries = matchupScores.filter((entry) => entry.margin === maxMargin);
      for (const { week, winnerId, winnerScore, loserScore, loserId } of blowoutEntries) {
        trophies.push({
          trophyType: "season-largest-blowout",
          year: year.year,
          week,
          managerId: winnerId,
          note: `${maxMargin.toFixed(2)}pts (${winnerScore.toFixed(2)}-${loserScore.toFixed(2)} against ${loserId})`,
        });
      }

      // Season points for trophy - max points for across all managers, include all if tie
      const maxPointsFor = Math.max(...Object.values(pointsFor));
      const pointsForEntries = typedEntries(pointsFor).filter(
        ([, points]) => points === maxPointsFor
      );
      for (const [managerId] of pointsForEntries) {
        trophies.push({
          trophyType: "season-points-for",
          year: year.year,
          managerId: managerId as ManagerId,
          note: `${maxPointsFor.toFixed(2)}pts`,
        });
      }

      // Season points against trophy - min points against across all managers, include all if tie
      const minPointsAgainst = Math.min(
        ...Object.values(pointsAgainst).filter((points) => points > 0)
      );
      const pointsAgainstEntries = typedEntries(pointsAgainst).filter(
        ([, points]) => points === minPointsAgainst
      );
      for (const [managerId] of pointsAgainstEntries) {
        trophies.push({
          trophyType: "season-points-against",
          year: year.year,
          managerId: managerId as ManagerId,
          note: `${minPointsAgainst.toFixed(2)}pts`,
        });
      }
    });

  return {
    dataAvailableFromYear,
    trophies,
  };
}
