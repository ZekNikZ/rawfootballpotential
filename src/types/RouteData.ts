import { Icon } from "@phosphor-icons/react";
import { League } from "./data/leagues";

export interface RouteData {
  path: string;
  title: string;
  element: React.ReactNode;
  navbarProperties?: {
    label?: string;
    icon: Icon;
    shouldHighlight?: (pathname: string) => boolean;
    isAvailable?: (leagueType: League["leagueType"]) => boolean;
    isDisabled?: (leagueType: League["leagueType"]) => boolean;
  };
  children?: RouteData[];
}
