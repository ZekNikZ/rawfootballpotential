import { sleeperApi } from '../api';
import { LeagueId, Manager, ManagerId, Season, Team } from '../types';

export async function loadSeason(leagueId: LeagueId): Promise<Season> {
  // League data
  const league = (await sleeperApi.get(`/league/${leagueId}`)).data;

  // Managers
  const managers: Record<ManagerId, Manager> = Object.fromEntries(
    (await sleeperApi.get(`/league/${leagueId}/users`)).data.map((user: any) => [
      user.user_id,
      {
        userId: user.user_id,
        username: user.username,
        displayName: user.display_name,
        currentTeamName: user.metadata.team_name,
        avatarURL: `https://sleepercdn.com/avatars/${user.avatar}`,
        trophies: 'TODO',
      },
    ])
  );

  // Teams
  const rosters: Team[] = (await sleeperApi.get(`/league/${leagueId}/rosters`)).data.map(
    (roster: any) => ({
      rosterId: roster.roster_id,
      leagueId: roster.league_id,
      managerId: roster.owner_id,
      name:
        managers[roster.owner_id].currentTeamName ??
        `Team ${managers[roster.owner_id].displayName}`,
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
    })
  );

  // TODO: matchups
  const regularSeasonMatchups = 'TODO' as any;
  const playoffMatchups = 'TODO' as any;

  // TODO: brackets
  const playoffStructure = 'TODO' as any;
  const toiletBowlStructure = 'TODO' as any;

  // TODO: transactions
  const transactions = 'TODO' as any;

  // TODO: traded picks
  const tradedPicks = 'TODO' as any;

  // TODO: roster positions
  const rosterPositions = 'TODO' as any;

  return {
    leagueId,
    name: league.name,
    previousLeagueId: league.previous_league_id,
    sport: 'nfl',
    teamCount: league.total_rosters,
    teams: rosters,
    year: parseInt(league.season, 10),
    seasonType: league.season_type,
    regularSeasonMatchups,
    playoffMatchups,
    playoffStructure,
    toiletBowlStructure,
    transactions,
    tradedPicks,
    divisions:
      league.settings.divisions > 0
        ? Array.from({ length: league.settings.divisions }, (v, k) => k + 1).map(
            (i) => league.metadata[`division_${i}`]
          )
        : null,
    managers,
    status: league.status,
    waiverType: league.settings.waiver_type === 2 ? 'faab' : 'normal',
    waiverMaxBudget: league.settings.waiver_budget,
    rosterPositions,
    playoffSpots: league.settings.playoff_teams,
  };
}
