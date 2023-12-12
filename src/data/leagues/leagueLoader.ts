import _ from 'lodash';
import { sleeperApi } from '../api';
import { League, LeagueId, Manager, ManagerId, Matchup, Team } from '../types';

export async function loadLeague(leagueId: LeagueId): Promise<League> {
  // League data
  const league = (await sleeperApi.get(`/league/${leagueId}`)).data;

  // Managers
  const currentManagers: Record<ManagerId, Manager> = Object.fromEntries(
    (await sleeperApi.get(`/league/${leagueId}/users`)).data.map((user: any) => [
      user.user_id,
      {
        userId: user.user_id,
        username: user.username,
        displayName: user.display_name,
        currentTeamName: user.metadata.team_name,
        currentTeamAvatarURL: user.metadata.avatar,
        avatarURL: `https://sleepercdn.com/avatars/${user.avatar}`,
        trophies: 'TODO',
      },
    ])
  );

  // Teams
  const rosters: Team[] = ((await sleeperApi.get(`/league/${leagueId}/rosters`)).data as any[]).map(
    (roster: any) => ({
      rosterId: roster.roster_id,
      leagueId: roster.league_id,
      managerId: roster.owner_id,
      name:
        currentManagers[roster.owner_id].currentTeamName ??
        `Team ${currentManagers[roster.owner_id].displayName}`,
      avatarURL: currentManagers[roster.owner_id].currentTeamAvatarURL,
      players: roster.players,
      reserve: roster.reserve,
      wins: roster.settings.wins,
      losses: roster.settings.losses,
      ties: roster.settings.ties,
      record: roster.metadata.record,
      streak: roster.metadata.streak,
      overallPointsFor: parseFloat(`${roster.settings.fpts}.${roster.settings.fpts_decimal}`),
      overallPointsAgainst: parseFloat(
        `${roster.settings.fpts_against}.${roster.settings.fpts_against_decimal}`
      ),
      overallMaxPoints: parseFloat(`${roster.settings.ppts}.${roster.settings.ppts_decimal}`),
      waiverPosition: roster.settings.waiver_position,
      waiverBudgetUsed: roster.settings.waiver_budget_used,
      division: roster.settings.division,
      totalRosterMoves: 'TODO' as any, // TODO
    })
  );

  // Matchups
  const numRegularSeasonWeeks = league.settings.playoff_week_start - 1;
  const numPlayoffWeeks = Math.ceil(Math.log2(league.settings.playoff_teams));
  const weeks = _.range(1, numRegularSeasonWeeks + numPlayoffWeeks + 1);
  const allMatchups: Matchup[] = _.flattenDeep(
    await Promise.all(
      weeks.map(async (week) => {
        const matchups = (await sleeperApi.get(`/league/${leagueId}/matchups/${week}`))
          .data as any[];
        const groupedMatchups = _.groupBy(matchups, (matchup) => matchup.matchup_id);
        return Object.entries(groupedMatchups).map(([matchupId, correspondingMatchups]) => ({
          week,
          matchupId: parseInt(matchupId, 10),
          leagueId,
          team1: {
            rosterId: correspondingMatchups[0].roster_id,
            points: correspondingMatchups[0].points,
            players: correspondingMatchups[0].players,
            starters: correspondingMatchups[0].starters,
            playerPoints: correspondingMatchups[0].players_points,
          },
          team2:
            correspondingMatchups.length === 2
              ? {
                  rosterId: correspondingMatchups[1].roster_id,
                  points: correspondingMatchups[1].points,
                  players: correspondingMatchups[1].players,
                  starters: correspondingMatchups[1].starters,
                  playerPoints: correspondingMatchups[1].players_points,
                }
              : ('TBD' as const),
        }));
      })
    )
  );

  return {
    leagueId,
    name: league.name,
    previousLeagueId: league.previous_league_id,
    sport: 'nfl',
    teamCount: league.total_rosters,
    teams: rosters,
    year: parseInt(league.season, 10),
    seasonType: league.season_type,
    matchups: allMatchups,
    playoffStructure: 'TODO' as any, // TODO
    toiletBowlStructure: 'TODO' as any, // TODO
    transactions: 'TODO' as any, // TODO
    tradedPicks: 'TODO' as any, // TODO
    divisions:
      league.settings.divisions > 0
        ? Array.from({ length: league.settings.divisions }, (v, k) => k + 1).map(
            (i) => league.metadata[`division_${i}`]
          )
        : null,
    divisionAvatars:
      league.settings.divisions > 0
        ? Array.from({ length: league.settings.divisions }, (v, k) => k + 1).map(
            (i) => league.metadata[`division_${i}_avatar`]
          )
        : null,
    currentManagers,
    status: league.status,
    waiverType: league.settings.waiver_type === 2 ? 'faab' : 'normal',
    waiverMaxBudget: league.settings.waiver_budget,
    rosterPositions: 'TODO' as any, // TODO
    playoffSpots: league.settings.playoff_teams,
    playoffWeekStart: league.settings.playoff_week_start,
    currentWeek: league.settings.leg,
    allManagers: 'TODO' as any, // TODO
    previousSeasons: 'TODO' as any, // TODO
    previousDrafts: 'TODO' as any, // TODO
    records: 'TODO' as any, // TODO
    trophies: 'TODO' as any, // TODO
  };
}
