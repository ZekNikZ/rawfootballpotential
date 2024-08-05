import { Icon } from "@phosphor-icons/react";
import { LeagueDefinition } from "./data";

export interface RouteData {
  path: string;
  title: string;
  element: React.ReactNode;
  navbarProperties?: {
    label?: string;
    icon: Icon;
    shouldHighlight?: (pathname: string) => boolean;
    isAvailable?: (leagueType: LeagueDefinition) => boolean;
    isDisabled?: (leagueType: LeagueDefinition) => boolean;
  };
  children?: RouteData[];
}
