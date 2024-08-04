import { NFLPlayerId, TeamId, TransactionId } from "./ids";

export interface TradedPick {
  year: number;
  round: number;
  originalOwner: TeamId;
  previousOwner: TeamId;
  currentOwner: TeamId;
}

export interface Transaction {
  transactionId: TransactionId;
  type: "trade" | "free_agent" | "waiver";
  involvedTeams: TeamId[];
  week: number;
  timestamp: number;
  movements: TransactionItem[];
}

export type TransactionItem =
  | {
      type: "player";
      playerId: NFLPlayerId;
      fromTeam?: TeamId;
      toTeam?: TeamId;
    }
  | {
      type: "waiver_budget";
      fromTeam?: TeamId;
      toTeam?: TeamId;
      amount: number;
    }
  | ({
      type: "pick";
      pick: TradedPick;
      fromTeam?: TeamId;
      toTeam?: TeamId;
    } & TradedPick);
