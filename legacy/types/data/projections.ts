import { LeagueId, NFLPlayerId } from "./ids";

export interface CachedProjections {
  year: number;
  week: number;
  leagueId: LeagueId;
  projections: Record<NFLPlayerId, number>;
}
