import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Config,
  FantasyRecord,
  IGlobalDataContext,
  League,
  LeagueId,
  NFLData,
  RecordCategory,
} from "../../types";
import { Api, RECORD_DEFINITIONS } from "../../utils";
import { notifications } from "@mantine/notifications";

const GlobalDataContext = createContext<IGlobalDataContext | undefined>(undefined);

export function GlobalDataProvider(props: PropsWithChildren) {
  // Global state
  const [loadingData, setLoadingData] = useState(true);
  const [config, setConfig] = useState<Config>();

  const [leagues, setLeagues] = useState<Record<LeagueId, League>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [records, setRecords] = useState<Record<LeagueId, (RecordCategory | FantasyRecord<any>)[]>>(
    {}
  );

  const [nflData, setNflData] = useState<NFLData>({ teams: {}, players: {} });

  // Loading notifications
  const [loadingString, setLoadingString] = useState<string>();
  const loadingNotificationIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!loadingString) {
      if (loadingNotificationIdRef.current) {
        notifications.hide(loadingNotificationIdRef.current);
      }
      loadingNotificationIdRef.current = null;
    } else if (!loadingNotificationIdRef.current) {
      loadingNotificationIdRef.current = notifications.show({
        title: "Loading league data & records",
        message: `Loading ${loadingString}...`,
        loading: true,
        autoClose: false,
        withCloseButton: false,
      });
    } else {
      notifications.update({
        id: loadingNotificationIdRef.current,
        title: "Loading league data & records",
        message: `Loading ${loadingString}...`,
        loading: true,
        autoClose: false,
        withCloseButton: false,
      });
    }
  }, [loadingString]);

  // Helper functions
  const loadData = useCallback(async (openChangelogModal?: () => void) => {
    notifications.clean();

    setLoadingData(true);
    let config;
    let nflData;
    try {
      // Config
      setLoadingString("config");
      const configResponse = await Api.getConfig();
      if (configResponse.success) {
        setConfig(configResponse.data);
        config = configResponse.data;
      } else {
        throw new Error(configResponse.error);
      }

      // Leagues
      for (const year of config.leagues.flatMap((league) =>
        league.years.map((year) => ({ ...year, type: league.name }))
      )) {
        // Config
        setLoadingString(`league (${year.type} ${year.year})`);
        const leagueResponse = await Api.getLeague(year.leagueId);
        if (leagueResponse.success) {
          setLeagues((leagues) => ({
            ...leagues,
            [year.leagueId]: leagueResponse.data,
          }));
        } else {
          throw new Error(leagueResponse.error);
        }
      }

      // NFL Data
      setLoadingString("NFL teams & players");
      const nflResponse = await Api.getNFLData();
      if (nflResponse.success) {
        setNflData(nflResponse.data);
        nflData = nflResponse.data;
      } else {
        throw new Error(nflResponse.error);
      }
    } catch (err) {
      // TODO: error handling
      console.error(err);
      notifications.show({
        title: "Error loading league data",
        message: "Try refreshing the page or try again later.",
        color: "red",
        autoClose: false,
        withCloseButton: false,
      });
      return;
    } finally {
      setLoadingString(undefined);
      setLoadingData(false);
    }

    // Compute records
    setLeagues((leagues) => {
      for (const league of config.leagues) {
        setLoadingString(`records (${league.name})`);
        setRecords((records) => ({
          ...records,
          [league.name]: RECORD_DEFINITIONS.map((def) => {
            if (def.type === "category") {
              return {
                type: "category",
                name: def.name,
                category: def.category,
                children: def.children.map((subdef) =>
                  subdef.generateRecord(subdef, league, leagues, nflData)
                ),
              };
            } else {
              return def.generateRecord(def, league, leagues, nflData);
            }
          }),
        }));
      }

      setLoadingString(undefined);

      return leagues;
    });

    // Open changelog
    setTimeout(() => {
      openChangelogModal?.();
    }, 1000);
  }, []);

  return (
    <GlobalDataContext.Provider
      value={{
        loadingData,
        setLoadingData,
        loadData,
        config,
        setConfig,
        leagues,
        records,
        nflData,
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
