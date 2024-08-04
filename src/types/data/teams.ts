import { LeagueId, ManagerId, NFLPlayerId, TeamId } from "./ids";

export interface Team {
  teamdId: TeamId;
  leagueId: LeagueId;
  managerId: ManagerId;
  division?: string;
  name: string;
  avatar?: string;
  players: NFLPlayerId[];
  bench: NFLPlayerId[];
  injuryReserve: NFLPlayerId[];
}
