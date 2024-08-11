import { Draft } from "./drafts";
import { LeagueSource, Position } from "./enums";
import { LeagueId, ManagerId } from "./ids";
import { Manager } from "./managers";
import { Bracket, Matchup } from "./matchups";
import { Team } from "./teams";
import { TradedPick, Transaction } from "./transactions";

interface ManagerData {
  managers: Record<ManagerId, Manager>;
}

interface TeamData {
  teams: Record<ManagerId, Team>;
  teamCount: number;
  divisionNames?: string[];
  divisionAvatars?: string[];
  rosterPositions: Position[];
  benchSize: number;
  injuryReserveSize: number;
}

interface MatchupData {
  matchups: Matchup[];
  winnersBracket: Bracket;
  losersBracket?: Bracket;
  playoffSpots: number;
  playoffWeekStart: number;
  totalWeekCount: number;
}

type TransactionData = {
  waiverType: "normal" | "faab";
  waiverMaxBudget?: number;
} & (
  | { hasTransactionData: false }
  | {
      hasTransactionData: true;
      transactions: Transaction[];
      tradedPicks: TradedPick[];
    }
);

export interface League {
  leagueId: LeagueId;
  year: number;
  leagueType: "redraft" | "dynasty";
  status: "in_season" | "complete";
  source: LeagueSource;
  sleeperLeagueId?: string;
  mangerData: ManagerData;
  teamData: TeamData;
  matchupData: MatchupData;
  transactionData: TransactionData;
  draft?: Draft;
}
