import _ from 'lodash';
import { sleeperApi } from '../api';
import {
  Bracket,
  BracketMatch,
  League,
  LeagueId,
  Manager,
  ManagerId,
  Matchup,
  NFLPlayerId,
  PreviousSeason,
  RosterId,
  Team,
  Transaction,
  TransactionItem,
} from '../types';

async function getLeagueUsers(leagueId: LeagueId): Promise<Record<string, Manager>> {
  return Object.fromEntries(
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
}

async function getRosters(
  leagueId: LeagueId,
  managers: Record<ManagerId, Manager>
): Promise<Team[]> {
  return ((await sleeperApi.get(`/league/${leagueId}/rosters`)).data as any[]).map(
    (roster: any) => ({
      rosterId: roster.roster_id,
      leagueId: roster.league_id,
      managerId: roster.owner_id,
      name:
        managers[roster.owner_id].currentTeamName ??
        `Team ${managers[roster.owner_id].displayName}`,
      avatarURL: managers[roster.owner_id].currentTeamAvatarURL,
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
}

async function getMatchupsForWeek(leagueId: LeagueId, week: number): Promise<Matchup[]> {
  const matchups = (await sleeperApi.get(`/league/${leagueId}/matchups/${week}`)).data as any[];
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
        : ('BYE' as const),
  }));
}

async function getMatchupsForWeeks(leagueId: LeagueId, weeks: number[]): Promise<Matchup[]> {
  return _.flattenDeep(
    await Promise.all(weeks.map(async (week) => getMatchupsForWeek(leagueId, week)))
  );
}

async function getBracket(leagueId: LeagueId, bracketType: 'winners' | 'losers'): Promise<Bracket> {
  const bracket: Bracket = {
    matches: (
      (await sleeperApi.get(`/league/${leagueId}/${bracketType}_bracket`)).data as any[]
    ).map((match) => ({
      round: match.r,
      matchupId: match.m,
      team1: match.t1
        ? { source: 'determined', rosterId: match.t1 }
        : match.t1_from
        ? {
            source: 'previous-match',
            matchId: Object.values(match.t1_from)[0] as any,
            result: Object.keys(match.t1_from)[0] === 'l' ? 'loser' : 'winner',
          }
        : { source: 'TBD' },
      team2: match.t2
        ? { source: 'determined', rosterId: match.t2 }
        : match.t2_from
        ? {
            source: 'previous-match',
            matchId: Object.values(match.t2_from)[0] as any,
            result: Object.keys(match.t2_from)[0] === 'l' ? 'loser' : 'winner',
          }
        : { source: 'TBD' },
      winner: match.w ?? null,
      loser: match.l ?? null,
      determinesPlacement: match.p ?? null,
    })),
  };
  [...bracket.matches]
    .filter(
      (match) =>
        match.team1.source === 'determined' &&
        (match.team2.source === 'TBD' || match.team2.source === 'previous-match')
    )
    .forEach((match, i) => {
      bracket.matches.push({
        round: match.round - 1,
        matchupId: -i,
        team1: match.team1,
        team2: { source: 'BYE' },
        winner: (match.team1 as Extract<BracketMatch['team1'], { source: 'determined' }>).rosterId,
        loser: null,
        determinesPlacement: null,
      });
    });
  return bracket;
}

async function getTransactionsForWeek(leagueId: LeagueId, week: number): Promise<Transaction[]> {
  return ((await sleeperApi.get(`/league/${leagueId}/transactions/${week}`)).data as any[])
    .filter((transaction) => transaction.status === 'complete')
    .map((transaction) => {
      const movements: TransactionItem[] = [];

      // Find player trades
      const adds: Record<NFLPlayerId, RosterId> = transaction.adds ?? {};
      const drops: Record<NFLPlayerId, RosterId> = transaction.drops ?? {};
      const players = new Set([...Object.keys(adds), ...Object.keys(drops)]);
      players.forEach((playerId) => {
        const movement: TransactionItem = {
          type: 'player',
          playerId,
          fromTeam: drops[playerId] ?? null,
          toTeam: adds[playerId] ?? null,
        };
        movements.push(movement);
      });

      // Find budget trades
      (transaction.waiver_budget as any[]).forEach(({ sender, reciever, amount }) =>
        movements.push({
          type: 'waiver_budget',
          amount,
          fromTeam: sender,
          toTeam: reciever,
        })
      );

      // Find pick trades
      (transaction.draft_picks as any[]).forEach((pick) =>
        movements.push({
          type: 'pick',
          ...pick,
        })
      );

      return {
        transactionId: transaction.transaction_id,
        type: transaction.type,
        involvedTeams: transaction.roster_ids,
        week: transaction.leg,
        timestamp: transaction.status_updated,
        movements,
      };
    });
}

async function getTransactionsForWeeks(
  leagueId: LeagueId,
  weeks: number[]
): Promise<Transaction[]> {
  return _.flattenDeep(
    await Promise.all(weeks.map(async (week) => getTransactionsForWeek(leagueId, week)))
  );
}

async function getPreviousSeason(leagueId: LeagueId): Promise<PreviousSeason> {
  return {} as any;
}

export async function loadLeague(
  leagueId: LeagueId,
  progressCallback?: (currentStage: string) => void
): Promise<League> {
  // League data
  progressCallback?.('league data');
  const league = (await sleeperApi.get(`/league/${leagueId}`)).data;

  // Managers
  progressCallback?.('managers');
  const currentManagers: Record<ManagerId, Manager> = await getLeagueUsers(leagueId);

  // Teams
  progressCallback?.('teams');
  const rosters: Team[] = await getRosters(leagueId, currentManagers);

  // Matchups
  progressCallback?.('matchups');
  const numRegularSeasonWeeks = league.settings.playoff_week_start - 1;
  const numPlayoffWeeks = Math.ceil(Math.log2(league.settings.playoff_teams));
  const weeks = _.range(1, numRegularSeasonWeeks + numPlayoffWeeks + 1);
  const matchups = await getMatchupsForWeeks(leagueId, weeks);

  // Winners bracket
  progressCallback?.('winners bracket');
  const winnersBracket: Bracket = await getBracket(leagueId, 'winners');

  // Losers bracket
  progressCallback?.('losers bracket');
  const losersBracket: Bracket = await getBracket(leagueId, 'losers');

  // Transactions
  progressCallback?.('transactions');
  const transactions: Transaction[] = await getTransactionsForWeeks(leagueId, weeks);

  // Previous seasons
  progressCallback?.('previous seasons');
  const previousSeasons: PreviousSeason[] = [];
  let previousLeagueId: LeagueId | null | undefined = leagueId;
  while (previousLeagueId) {
    // eslint-disable-next-line no-await-in-loop
    const previousSeason: PreviousSeason = await getPreviousSeason(previousLeagueId);
    previousSeasons.push(previousSeason);
    previousLeagueId = previousSeason.previousLeagueId;
  }
  // TODO: load JSON previous seasons

  // TODO: Records

  return {
    leagueId,
    name: league.name,
    previousLeagueId: league.previous_league_id,
    sport: 'nfl',
    teamCount: league.total_rosters,
    teams: rosters,
    year: parseInt(league.season, 10),
    seasonType: league.season_type,
    matchups,
    winnersBracket,
    losersBracket,
    transactions,
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
    rosterPositions: league.roster_positions,
    playoffSpots: league.settings.playoff_teams,
    playoffWeekStart: league.settings.playoff_week_start,
    currentWeek: league.settings.leg,
    totalWeekCount: weeks.length,
    allManagers: 'TODO' as any, // TODO
    previousSeasons: 'TODO' as any, // TODO
    previousDrafts: 'TODO' as any, // TODO
    records: 'TODO' as any, // TODO
    trophies: 'TODO' as any, // TODO
  };
}
