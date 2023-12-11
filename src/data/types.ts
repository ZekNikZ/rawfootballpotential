// type Position =
//   | 'QB'
//   | 'RB'
//   | 'WR'
//   | 'TE'
//   | 'FLEX'
//   | 'K'
//   | 'BN'
//   | 'REC_FLEX'
//   | 'SUPER_FLEX'
//   | 'IDP_FLEX';

// interface Player {
//   playerId: string;
// }

// interface Manager {
//   managerId: string;
//   username: string;
//   displayName: string;
//   teamName: string;
// }

// interface Team {
//   rosterId: string;
//   manager: Manager;
//   pointsFor: number;
//   pointsAgainst: number;
//   wins: number;
//   losses: number;
//   ties: number;
//   waiverPosition: number;
//   waiverBudgetUsed: number;
//   waiverBudgetRemaining: number;
//   totalRosterMoves: number;
//   players: Player[];
//   reserve: Player[];
// }

// interface Draft {
//   draftId: string;
// }

// interface Transaction {
//   transactionId: string;
//   type: 'trade' | 'free_agent' | 'waiver';
// }

// interface League {
//   leagueId: string;
//   previousLeagueId?: string | null;
//   sport: 'nfl';
//   managers: Manager[];
//   teamCount: number;
//   teams: Team[];
//   status: 'in_season' | 'complete';
//   season: number;
//   seasonType: string;
//   draft: Draft;
//   name: string;
//   rosterPositions: Position[];
//   regularSeasonMatchups: Matchup[];
//   playoffMatchups: Matchup[];
//   playoffStructure: Bracket;
//   toiletBowlStructure?: Bracket;
//   transactions: Transaction[];
// }
