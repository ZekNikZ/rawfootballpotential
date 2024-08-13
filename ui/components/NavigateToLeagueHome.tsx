import { Navigate } from "react-router-dom";
import { useGlobalData } from "../providers";

function NavigateToLeagueHome() {
  const { currentLeague } = useGlobalData();
  return <Navigate replace to={`/${currentLeague}`} />;
}

export default NavigateToLeagueHome;
