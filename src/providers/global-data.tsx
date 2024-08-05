import { createContext, PropsWithChildren, useContext, useState } from "react";
import { Config, IGlobalDataContext, LeagueId } from "../types";

const GlobalDataContext = createContext<IGlobalDataContext | undefined>(undefined);

export function GlobalDataProvider(props: PropsWithChildren) {
  const [config, setConfig] = useState<Config>();
  const [currentLeague, setCurrentLeague] = useState<LeagueId>();

  return (
    <GlobalDataContext.Provider
      value={{
        config,
        setConfig,
        currentLeague,
        setCurrentLeague,
      }}
    >
      {props.children}
    </GlobalDataContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useGlobalData() {
  const context = useContext(GlobalDataContext);
  if (!context) {
    throw new Error("useGlobalData must be used within a GlobalDataProvider");
  }
  return context;
}
