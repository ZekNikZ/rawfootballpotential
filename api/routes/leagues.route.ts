import { Router, Response } from "express";
import {
  Bracket,
  Draft,
  GetLeagueResponse,
  League,
  LeagueId,
  Manager,
  ManagerId,
  Matchup,
  MatchupId,
  NFLPlayerId,
  Position,
  Team,
  TeamId,
} from "../../types";
import { configService } from "../services";
import _ from "lodash";
import { makeError, typedFromEntries } from "../../utils";
import { projectionsService } from "../services/projections.service";
import { logger } from "../logger";
import { leagueService } from "../services/league.service";

export const leaguesRouter = Router();

leaguesRouter.get("/leagues/:leagueId", async (req, res: Response<GetLeagueResponse>) => {
  const { leagueId: lid } = req.params;
  const leagueId = lid as LeagueId;

  // Figure out where the data for this league is
  logger.info("Fetching config...");
  const config = await configService.findOne();
  if (!config) {
    return res.status(500).json(makeError("Could not find configuration"));
  }

  const years = config.leagues.flatMap((league) =>
    league.years.map((x) => ({ ...x, leagueGroup: league.type }))
  );
  const year = years.find((year) => year.leagueId === leagueId);
  if (!year) {
    return res.status(404).json(makeError("Could not find league source"));
  }

  logger.info("Fetching league metadata...");
  const source = year.source;
  if (source === "sleeper") {
    logger.info("League is from SLEEPER");

    // Fetch league data
    logger.info(`Fetching sleeper league ${year.internalId}...`);
    const leagueResponse = await fetch(`https://api.sleeper.app/v1/league/${year.internalId}`);
    if (!leagueResponse.ok) {
      return res
        .status(404)
        .json(makeError("Could not find league data", "Could not load data from Sleeper."));
    }
    const leagueJson = await leagueResponse.json();
    const divisionNames =
      leagueJson.settings.divisions > 0
        ? Array.from({ length: leagueJson.settings.divisions }, (_, k) => k + 1).map(
            (i) => leagueJson.metadata[`division_${i}`]
          )
        : undefined;
    const divisionAvatars =
      leagueJson.settings.divisions > 0
        ? Array.from({ length: leagueJson.settings.divisions }, (_, k) => k + 1).map(
            (i) => leagueJson.metadata[`division_${i}_avatar`]
          )
        : undefined;

    // Compute weeks
    const numRegularSeasonWeeks = leagueJson.settings.playoff_week_start - 1;
    const numPlayoffWeeks = Math.ceil(Math.log2(leagueJson.settings.playoff_teams));
    const weeks = _.range(1, numRegularSeasonWeeks + numPlayoffWeeks + 1);

    // Fetch manager data
    logger.info(`Fetching managers...`);
    const managerResponse = await fetch(
      `https://api.sleeper.app/v1/league/${year.internalId}/users`
    );
    if (!managerResponse.ok) {
      return res
        .status(404)
        .json(makeError("Could not find manager data", "Could not load data from Sleeper."));
    }
    const managerJson = await managerResponse.json();
    const managers: Record<ManagerId, Manager> = typedFromEntries(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (managerJson as any[]).map((manager) => {
        const configManager = config.managers.find((m) => m.sleeperIds.includes(manager.user_id));
        const managerId = configManager?.id ?? `M-ERROR-${manager.user_id}`;
        return [
          managerId,
          {
            managerId,
            avatar: manager.metadata?.avatar,
            name: configManager?.name ?? manager.display_name,
          },
        ] as [ManagerId, Manager];
      })
    );

    // Fetch team data
    logger.info(`Fetching rosters...`);
    const teamResponse = await fetch(
      `https://api.sleeper.app/v1/league/${year.internalId}/rosters`
    );
    if (!teamResponse.ok) {
      return res
        .status(404)
        .json(makeError("Could not find team data", "Could not load data from Sleeper."));
    }
    const teamJson = await teamResponse.json();
    const teams: Record<TeamId, Team> = typedFromEntries(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (teamJson as any[]).map((team) => {
        const managerId =
          config.managers.find((manager) => manager.sleeperIds.includes(team.owner_id))?.id ??
          `M-NOT-CONFIGURED-${team.owner_id}`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const managerData = (managerJson as any[]).find(
          (manager) => manager.user_id === team.owner_id
        );
        return [
          `R-${team.league_id}-${team.roster_id}`,
          {
            teamId: `R-${team.league_id}-${team.roster_id}`,
            leagueId,
            managerId,
            division: divisionNames ? divisionNames[(team.settings.division ?? 0) - 1] : undefined,
            name: managerData.metadata.team_name ?? `Team ${managerData.display_name}`,
            avatar: managerData.metadata.avatar
              ? `https://sleepercdn.com/avatars/${managerData.metadata.avatar}`
              : undefined,
            // FIXME: convert to NFL IDs
            players: team.starters, // .starters
            bench: team.players.filter(
              (p: string) => !team.starters.includes(p) && !(team.reserve ?? []).includes(p)
            ), // .players - .starters
            injuryReserve: team.reserve ?? [], // .reserve
            sleeperRosterId: team.roster_id,
            playoffSortOrder:
              team.settings.wins * 100000000 +
              team.settings.fpts * 10000 +
              team.settings.fpts_against,
          },
        ] as [TeamId, Team];
      })
    );
    const teamAssignments: Record<ManagerId, TeamId> = typedFromEntries(
      Object.entries(teams).map(([teamId, team]) => [team.managerId, teamId] as [ManagerId, TeamId])
    );
    const playoffQualifiedTeams = _.take(
      Object.values(teams).sort((a, b) => b.playoffSortOrder! - a.playoffSortOrder!),
      leagueJson.settings.playoff_teams
    ).map((team) => team.teamId);

    // Fetch projections
    logger.info(`Fetching projections...`);
    const projections = typedFromEntries(
      await Promise.all(
        weeks.map(async (week) => {
          const weekProjections = await projectionsService.getProjectionsForWeek(
            year.year,
            week,
            leagueId,
            leagueJson.scoring_settings
          );

          return [`${week}`, weekProjections.projections] as [string, Record<NFLPlayerId, number>];
        })
      )
    );

    // Fetch matchup data
    logger.info(`Fetching matchups...`);
    const matchups = _.flattenDeep(
      await Promise.all(
        weeks.map(async (week) => {
          logger.info(`Fetching week ${week} matchups...`);
          const matchupsResponse = await fetch(
            `https://api.sleeper.app/v1/league/${year.internalId}/matchups/${week}`
          );
          console.log(`https://api.sleeper.app/v1/league/${year.internalId}/matchups/${week}`);
          const matchupsJson = await matchupsResponse.json();
          const groupedMatchups = _.groupBy(matchupsJson, (matchup) => matchup.matchup_id);
          return Object.entries(groupedMatchups).map(([matchupId, correspondingMatchups]) => ({
            week,
            matchupId: `M-${week}-${matchupId}` as MatchupId,
            leagueId,
            team1: {
              teamId: `R-${year.internalId}-${correspondingMatchups[0].roster_id}` as TeamId,
              hasPlayerData: true,
              points: correspondingMatchups[0].custom_points ?? correspondingMatchups[0].points,
              werePointsOverrided: !!correspondingMatchups[0].custom_points,
              players: correspondingMatchups[0].starters.map((x: string) => (x === "0" ? null : x)), // .starters
              bench: correspondingMatchups[0].players.filter(
                (p: string) =>
                  !correspondingMatchups[0].starters.includes(p) &&
                  !(correspondingMatchups[0].reserve ?? []).includes(p)
              ), // .players - .starters
              injuryReserve: correspondingMatchups[0].reserve ?? [], // .reserve
              playerPoints: correspondingMatchups[0].players_points,
              playerProjectedPoints: (correspondingMatchups[0].players as NFLPlayerId[]).reduce<
                Record<NFLPlayerId, number>
              >((res, playerId) => ({ ...res, [playerId]: projections[`${week}`][playerId] }), {}),
            },
            team2:
              correspondingMatchups.length === 2
                ? {
                    teamId: `R-${year.internalId}-${correspondingMatchups[1].roster_id}` as TeamId,
                    hasPlayerData: true,
                    points:
                      correspondingMatchups[1].custom_points ?? correspondingMatchups[1].points,
                    werePointsOverrided: !!correspondingMatchups[1].custom_points,
                    players: correspondingMatchups[1].starters.map((x: string) =>
                      x === "0" ? null : x
                    ), // .starters
                    bench: correspondingMatchups[1].players.filter(
                      (p: string) =>
                        !correspondingMatchups[1].starters.includes(p) &&
                        !(correspondingMatchups[1].reserve ?? []).includes(p)
                    ), // .players - .starters
                    injuryReserve: correspondingMatchups[1].reserve ?? [], // .reserve
                    playerPoints: correspondingMatchups[1].players_points,
                    playerProjectedPoints: (
                      correspondingMatchups[1].players as NFLPlayerId[]
                    ).reduce<Record<NFLPlayerId, number>>(
                      (res, playerId) => ({ ...res, [playerId]: projections[`${week}`][playerId] }),
                      {}
                    ),
                  }
                : ("BYE" as const),
          })) as Matchup[];
        })
      )
    );

    // TODO: Fetch winners bracket
    const winnersBracket = "NOT IMPLEMENTED" as unknown as Bracket;

    // TODO: Fetch losers bracket
    const losersBracket = "NOT IMPLEMENTED" as unknown as Bracket;

    // TODO: Fetch transactions

    // TODO: Fetch draft
    const draft = "NOT IMPLEMENTED" as unknown as Draft;

    logger.info("Complete!");
    return res.json({
      success: true,
      data: {
        leagueId: year.leagueId,
        year: parseInt(leagueJson.season, 10),
        leagueType: year.leagueGroup,
        status: leagueJson.status,
        source: year.source,
        sleeperLeagueId: year.internalId,
        mangerData: {
          managers,
          teamAssignments,
        },
        teamData: {
          teams,
          teamCount: Object.keys(teams).length,
          divisionNames,
          divisionAvatars,
          rosterPositions: (leagueJson.roster_positions as string[]).filter(
            (pos) => pos !== "BN"
          ) as Position[],
          benchSize: (leagueJson.roster_positions as string[]).filter((pos) => pos === "BN").length,
          injuryReserveSize: leagueJson.settings.reserve_slots ?? 0,
          playoffQualifiedTeams,
        },
        matchupData: {
          matchups,
          winnersBracket,
          losersBracket,
          playoffSpots: leagueJson.settings.playoff_teams,
          playoffWeekStart: leagueJson.settings.playoff_week_start,
          totalWeekCount: numRegularSeasonWeeks + numPlayoffWeeks,
          medianEnabled: leagueJson.settings.league_average_match === 1,
        },
        transactionData: "NOT IMPLEMENTED" as unknown as League["transactionData"],
        draft,
      },
    });
  } else {
    const league = await leagueService.findById(leagueId);
    if (!league) {
      return res
        .status(404)
        .json(makeError("Could not find league data", "Could not load ESPN data from cache."));
    }

    return res.json({
      success: true,
      data: league,
    });
  }
});
