import { createContext, useContext } from "react";
import type { League, Season } from "../api/schemas";

export interface LeagueContextValue {
  league: League;
  leagues: League[];
  /** The most recent season of the league (in progress or complete). */
  latestSeason: Season;
}

export const LeagueContext = createContext<LeagueContextValue | null>(null);

export function useLeague(): LeagueContextValue {
  const ctx = useContext(LeagueContext);
  if (!ctx) throw new Error("useLeague must be used inside a league route");
  return ctx;
}

/** Path helper: `/${league}/...`. */
export function useLeaguePath() {
  const { league } = useLeague();
  return (rest = "") => `/${league.slug}${rest}`;
}
