import { createContext, PropsWithChildren, useCallback, useContext } from "react";
import { ICurrentLeagueContext, League, LeagueId } from "../../types";
import { useNavigate, useParams } from "react-router-dom";

const CurrentLeagueContext = createContext<ICurrentLeagueContext | undefined>(undefined);

export function CurrentLeagueProvider(props: PropsWithChildren) {
  const { leagueId } = useParams();
  const navigate = useNavigate();

  const league = "NOT IMPLEMENTED" as unknown as League;

  const setLeagueId = useCallback(
    (leagueId: LeagueId) => {
      navigate(`/${leagueId}`);
    },
    [navigate]
  );

  return (
    <CurrentLeagueContext.Provider
      value={{
        leagueId: leagueId as LeagueId,
        setLeagueId,
        league,
      }}
    >
      {props.children}
    </CurrentLeagueContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCurrentLeague() {
  const context = useContext(CurrentLeagueContext);
  if (!context) {
    throw new Error("useCurrentLeague must be used within a CurrentLeagueProvider");
  }
  return context;
}
