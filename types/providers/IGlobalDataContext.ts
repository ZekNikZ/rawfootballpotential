import React from "react";
import { Config, FantasyRecord, League, LeagueId, NFLData, RecordCategory } from "../data";

export interface IGlobalDataContext {
  loadingData: boolean;
  setLoadingData: React.Dispatch<React.SetStateAction<boolean>>;

  loadData: (openChangelogModal?: () => void) => Promise<void>;

  config?: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config | undefined>>;

  leagues: Record<LeagueId, League>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  records: Record<string, (FantasyRecord<any> | RecordCategory)[]>;

  nflData: NFLData;
}
