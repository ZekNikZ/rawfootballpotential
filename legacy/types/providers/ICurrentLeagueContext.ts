import { League, LeagueId } from "../data";

export interface ICurrentLeagueContext {
  leagueId: LeagueId;
  setLeagueId: (leagueId: LeagueId) => void;

  league: League;
}
