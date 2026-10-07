import { DraftId, LeagueId, NFLPlayerId, TeamId } from "./ids";

export interface Draft {
  draftId: DraftId;
  type: "snake" | "auction";
  leagueId: LeagueId;
  draftOrder?: TeamId[];
  picks: DraftPick[];
}

export interface DraftPick {
  playerId: NFLPlayerId;
  draftId: DraftId;
  rosterId: TeamId;
  pickNumber: number;
  round: number;
  column: number;
}
