import { LeagueSource } from "./enums";
import { LeagueId, TeamId } from "./ids";
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
    finalPlacements: Record<TeamId, number>;
  }[];
}

export interface ManagerDefinition {
  id: string;
  name: string;
  sleeperIds: string[];
}

export interface Config {
  metadata: {
    name: string;
  };
  leagues: LeagueDefinition[];
  managers: ManagerDefinition[];
}
