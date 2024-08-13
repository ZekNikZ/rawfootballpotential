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
    const managers = "NOT IMPLEMENTED" as unknown as Record<ManagerId, Manager>;

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
    const teams: Record<ManagerId, Team> = typedFromEntries(
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
          managerId,
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
        ] as [ManagerId, Team];
      })
    );

    // Fetch matchup data
    const numRegularSeasonWeeks = leagueJson.settings.playoff_week_start - 1;
    const numPlayoffWeeks = Math.ceil(Math.log2(leagueJson.settings.playoff_teams));
    const weeks = _.range(1, numRegularSeasonWeeks + numPlayoffWeeks + 1);
    const matchups = _.flattenDeep(
      await Promise.all<Matchup[]>(
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
                  }
                : ("BYE" as const),
          }));
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
