import React from "react";
import { Config, LeagueId } from "../data";

export interface IGlobalDataContext {
  config?: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config | undefined>>;

  currentLeague?: LeagueId;
  setCurrentLeague: React.Dispatch<React.SetStateAction<LeagueId | undefined>>;
}
