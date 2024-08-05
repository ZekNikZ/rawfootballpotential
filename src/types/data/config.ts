import { LeagueSource } from "./enums";
import { LeagueId } from "./ids";

export interface LeagueDefinition {
  name: string;
  color: string;
  years: {
    source: LeagueSource;
    year: number;
    leagueId: LeagueId;
    internalId: string;
  }[];
}

export interface Config {
  metadata: {
    name: string;
  };
  leagues: LeagueDefinition[];
}
