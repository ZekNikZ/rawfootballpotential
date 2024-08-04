import { LeagueSource } from "../data";

export interface GetConfigResponse {
  metadata: {
    name: string;
  };
  leagues: {
    name: string;
    color: string;
    years: {
      source: LeagueSource;
      year: number;
      id: string;
    }[];
  }[];
}
