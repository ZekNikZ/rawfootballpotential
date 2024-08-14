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

export const leaguesRouter = Router();

leaguesRouter.get("/leagues/:leagueId", async (req, res: Response<GetLeagueResponse>) => {
  const { leagueId: lid } = req.params;
  const leagueId = lid as LeagueId;

  // Figure out where the data for this league is
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

  const source = year.source;
  if (source === "sleeper") {
    // Fetch league data
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

    // TODO: Fetch manager data
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
          },
        ] as [TeamId, Team];
      })
    );
    const teamAssignments: Record<ManagerId, TeamId> = typedFromEntries(
      Object.entries(teams).map(([teamId, team]) => [team.managerId, teamId] as [ManagerId, TeamId])
    );

    // Fetch projections
    const projections = typedFromEntries(
      await Promise.all(
        weeks.map(async (week) => {
          const projectionsResponse = await fetch(
            `https://api.sleeper.app/projections/nfl/${year.year}/${week}?season_type=regular&position%5B%5D=DB&position%5B%5D=DEF&position%5B%5D=DL&position%5B%5D=FLEX&position%5B%5D=IDP_FLEX&position%5B%5D=K&position%5B%5D=LB&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=REC_FLEX&position%5B%5D=SUPER_FLEX&position%5B%5D=TE&position%5B%5D=WR&position%5B%5D=WRRB_FLEX&order_by=ppr`
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const projectionsJson: any[] = await projectionsResponse.json();

          const weekProjections = projectionsJson.reduce<Record<NFLPlayerId, number>>(
            (res, proj) => {
              const stats = proj.stats;
              let total = 0;

              if (stats) {
                Object.entries(stats).forEach(([stat, pts]) => {
                  total += (pts as number) * (leagueJson.scoring_settings[stat] ?? 0);
                });
              }

              return {
                ...res,
                [proj.player_id as NFLPlayerId]: total,
              };
            },
            {}
          );

          return [`${week}`, weekProjections] as [string, Record<NFLPlayerId, number>];
        })
      )
    );

    // Fetch matchup data
    const matchups = _.flattenDeep(
      await Promise.all(
        weeks.map(async (week) => {
          const matchupsResponse = await fetch(
            `https://api.sleeper.app/v1/league/${year.internalId}/matchups/${week}`
          );
          const matchupsJson = await matchupsResponse.json();
          const groupedMatchups = _.groupBy(matchupsJson, (matchup) => matchup.matchup_id);
          return Object.entries(groupedMatchups).map(([matchupId, correspondingMatchups]) => ({
            week,
            matchupId: `M-${week}-${matchupId}` as MatchupId,
            leagueId,
            team1: {
              teamId: `R-${year.internalId}-${correspondingMatchups[0].roster_id}` as TeamId,
              hasPlayerData: true,
              points: correspondingMatchups[0].points,
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
                    points: correspondingMatchups[1].points,
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
        },
        matchupData: {
          matchups,
          winnersBracket,
          losersBracket,
          playoffSpots: leagueJson.settings.playoff_teams,
          playoffWeekStart: leagueJson.settings.playoff_week_start,
          totalWeekCount: numRegularSeasonWeeks + numPlayoffWeeks,
        },
        transactionData: "NOT IMPLEMENTED" as unknown as League["transactionData"],
        draft,
      },
    });
  } else {
    return res.status(501).json(makeError("Not implemented"));
  }
});
