import { MantineColor } from "@mantine/core";
import { LeagueId } from "../types";

export interface LeagueDefinition {
  id: LeagueId;
  label: string;
  color: MantineColor;
  type: "redraft" | "dynasty";
  maxWaiverBudget?: number;
}

const leagues: LeagueDefinition[] = [
  {
    id: "L986655084714999808",
    label: "Redraft",
    color: "blue",
    type: "redraft",
  },
  {
    id: "L993972607831584768",
    label: "Dynasty",
    color: "red",
    type: "dynasty",
    maxWaiverBudget: 100,
  },
];

export function getLeague(id: LeagueId) {
  return leagues.filter((l) => l.id === id)[0];
}

export default leagues;
