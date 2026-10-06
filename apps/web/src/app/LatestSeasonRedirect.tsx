import { Navigate } from "react-router";
import { useLeague } from "../lib/league-context";

/** `/:league/standings` and friends: the same page for the league's latest season. */
export function LatestSeasonRedirect({ page }: { page: string }) {
  const { league, latestSeason } = useLeague();
  return <Navigate to={`/${league.slug}/${latestSeason.year}/${page}`} replace />;
}
