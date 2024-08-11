import { LeagueSource } from "./enums";
import { LeagueId } from "./ids";
import { League } from "./leagues";

export interface LeagueDefinition {
  name: string;
  type: League["leagueType"];
  color: string;
  years: {
    source: LeagueSource;
    year: number;
    leagueId: LeagueId;
    internalId: string;
  }[];
}

export interface ManagerDefinition {
  id: string;
  sleeperIds: string[];
}

export interface Config {
  metadata: {
    name: string;
  };
  leagues: LeagueDefinition[];
  managers: ManagerDefinition[];
}
