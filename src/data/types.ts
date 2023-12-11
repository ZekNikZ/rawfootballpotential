export type CachedData<T> =
  | {
      lastUpdate: number;
      data: T;
    }
  | {
      lastUpdate: null;
      data: null;
    };

export type LeagueId = string;
export type ManagerId = string;
export type TransactionId = string;
export type RosterId = number;
export type MatchupId = number;
export type DraftId = string;
export type NFLTeamId = string;
export type NFLPlayerId = string;

export type Position =
  | 'QB'
  | 'RB'
  | 'WR'
  | 'TE'
  | 'FLEX'
  | 'K'
  | 'BN'
  | 'REC_FLEX'
  | 'SUPER_FLEX'
  | 'IDP_FLEX';

export interface Season {
  leagueId: LeagueId;
  name: string;
  previousLeagueId?: string | null;
  sport: 'nfl';
  teamCount: number;
  teams: Record<RosterId, Team>;
  year: number;
  seasonType: string;
  regularSeasonMatchups: Matchup[];
  playoffMatchups: Matchup[];
  playoffStructure: Bracket;
  toiletBowlStructure?: Bracket;
  transactions: Transaction[] | null;
  tradedPicks: TradedPick[] | null;
  divisions: string[] | null;
  managers: Record<ManagerId, Manager>;
  status: 'in_season' | 'complete';
  waiverType: 'normal' | 'faab';
  waiverMaxBudget: number | null;
  rosterPositions: Position[];
  playoffSpots: number;
}

export interface League extends Season {
  previousSeasons: Record<number, Season>;
  records: FantasyRecord[];
  drafts: Record<DraftId, Draft>;
}

export interface NFLData {
  teams: Record<NFLTeamId, NFLTeam>;
  players: Record<NFLPlayerId, NFLPlayer>;
}

export interface Manager {
  managerId: ManagerId;
  username: string;
  displayName: string;
  currentTeamName: string;
  avatarURL: string;
  trophies: Trophy[];
}

export interface NFLTeam {
  teamId: NFLTeamId;
  name: string;
  iconURL: string;
}

export interface NFLPlayer {
  playerId: NFLPlayerId;
  firstName: string;
  lastName: string;
  positions: Position[];
  age: number | null;
  teamId: NFLTeamId | null;
  nflDepth: number | null;
  nflDepthPosition: Position | null;
  nflPosition: Position;
  injuryStatus: null | 'IR' | 'Out' | 'Questionable';
  avatarURL: string;
  jerseyNumber: number;
}

export interface Team {
  rosterId: RosterId;
  leagueId: LeagueId;
  managerId: ManagerId;
  name: string;
  players: NFLPlayerId[];
  reserve: NFLPlayerId[];
  wins: number;
  losses: number;
  ties: number;
  record: ('L' | 'W' | 'T')[];
  streak: string;
  overallPointsFor: number;
  overallPointsAgainst: number;
  overallMaxPoints: number;
  waiverPosition: number;
  waiverBudgetUsed: number;
  totalRosterMoves: number;
  division: number;
}

export interface Draft {
  draftId: DraftId;
  type: 'snake' | 'auction';
  leagueId: LeagueId;
  year: number;
  draftOrder: RosterId[] | null;
  picks: DraftPick[];
}

export interface DraftPick {
  playerId: NFLPlayerId;
  draftId: DraftId;
  rosterId: RosterId;
  pickNumber: number;
  round: number;
  column: number;
}

export interface TradedPick {
  year: number;
  round: number;
  originalOwner: RosterId;
  previousOwner: RosterId;
  currentOwner: RosterId;
}

export interface Transaction {
  transactionId: TransactionId;
  type: 'trade' | 'free_agent' | 'waiver';
  involvedTeams: RosterId[];
  timestamp: Date;
  adds: TradedPlayer[];
  drops: TradedPlayer[];
  draftPicks: TradedPick[];
  waiverBudget: {}[];
}

export interface TradedPlayer {
  playerId: NFLPlayerId;
  newTeam: RosterId;
}

export interface Matchup {
  matchupId: MatchupId;
  leagueId: LeagueId;
  week: number;
  team1: MatchupTeam;
  team2: MatchupTeam;
}

export interface MatchupTeam {
  teamId: RosterId;
  points: number;
  player: NFLPlayerId[];
  starters: NFLPlayerId[];
  playerPoints: Record<NFLPlayerId, number>;
}

export interface Bracket {
  matches: BracketMatch[];
}

export interface BracketMatch {
  round: number;
  matchupId: MatchupId;
  team1:
    | { source: 'determined'; teamId: RosterId }
    | { source: 'previous-match'; matchId: MatchupId };
  team2:
    | { source: 'determined'; teamId: RosterId }
    | { source: 'previous-match'; matchId: MatchupId };
  winner: RosterId | null;
  loser: RosterId | null;
  matchup: Matchup | null;
}

export type FantasyRecord = {
  name: string;
  scope: 'manager' | 'all-time' | 'season';
  timing: 'regular' | 'playoffs' | 'both';
  display: 'integer' | 'decimal' | 'percentage' | 'money';
  better: 'higher' | 'lower';
  trophyEligible: boolean;
} & (
  | {
      holder: 'manager';
      entries: {
        managerId: ManagerId;
        score: number;
        year: number;
        week: number | null;
        inPlayoffs: boolean | null;
      }[];
    }
  | {
      holder: 'team';
      entries: {
        managerId: ManagerId;
        teamId: RosterId;
        score: number;
        year: number;
        week: number | null;
        inPlayoffs: boolean | null;
      }[];
    }
  | {
      holder: 'player';
      entries: {
        managerId: ManagerId;
        playerId: NFLPlayerId;
        score: number;
        year: number;
        week: number | null;
        inPlayoffs: boolean | null;
      }[];
    }
  | {
      holder: 'matchup';
      entries: {
        team1Id: RosterId;
        team2Id: RosterId;
        team1Score: number;
        team2Score: number;
        recordScore: number;
        year: number;
        week: number | null;
        inPlayoffs: boolean | null;
      }[];
    }
);

export interface Trophy {
  name: string;
  placement: number;
}
