import { Navigate } from "react-router-dom";
import { useGlobalData } from "../providers";

function NavigateToLeagueHome() {
  const { config } = useGlobalData();

  const currentLeagueId = config!.leagues[0].years.reduce((prev, current) =>
    prev && prev.year > current.year ? prev : current
  ).leagueId;

  return <Navigate replace to={`/${currentLeagueId}`} />;
}

export default NavigateToLeagueHome;
