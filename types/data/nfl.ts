import { Position } from "./enums";
import { NFLPlayerId, NFLTeamId } from "./ids";

export interface NFLData {
  players: Record<NFLPlayerId, NFLPlayer>;
  teams: Record<NFLTeamId, NFLTeam>;
}

export interface NFLTeam {
  nflTeamId: NFLTeamId;
  name: string;
  shortCode: string;
  avatar: string;
}

export interface NFLPlayer {
  playerId: NFLPlayerId;
  avatar: string;
  firstName: string;
  lastName: string;
  fullName: string;
  age: number;
  positions: Position[];
  nflTeamId: NFLTeamId;
  nflDepth?: number;
  nflDepthPosition?: Position;
  nflPosition: Position;
  injuryStatus?: "IR" | "Out" | "Questionable";
  jerseyNumber: number;
}
