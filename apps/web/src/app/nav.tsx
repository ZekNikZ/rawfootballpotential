import type { Icon } from "@phosphor-icons/react";
import {
  ArrowsLeftRight,
  CalendarDot,
  CalendarDots,
  Columns,
  FootballHelmet,
  GridNine,
  Handshake,
  House,
  ListNumbers,
  Ranking,
  Rows,
  Ticket,
  Trophy,
  UsersFour,
  UsersThree,
} from "@phosphor-icons/react";
import type { League } from "../api/schemas";

export interface NavItem {
  key: string;
  label: string;
  icon: Icon;
  /** Target path; absent for groups that only expand. */
  to?: (league: League, season: number) => string;
  /** Pages that are not built yet show greyed out with a "Soon" badge and can't be clicked. */
  soon?: boolean;
  /** Only leagues of this type show the item. */
  only?: League["type"];
  /** Matches when the current path belongs to this item (exact for leaf pages). */
  end?: boolean;
  children?: NavItem[];
}

export const NAV: NavItem[] = [
  { key: "home", label: "Home", icon: House, to: (l) => `/${l.slug}`, end: true },
  {
    key: "standings",
    label: "Standings",
    icon: ListNumbers,
    to: (l, s) => `/${l.slug}/${s}/standings`,
  },
  {
    key: "matchups",
    label: "Matchups",
    icon: FootballHelmet,
    to: (l, s) => `/${l.slug}/${s}/matchups`,
  },
  {
    key: "teams",
    label: "Teams",
    icon: UsersThree,
    children: [
      {
        key: "divisions",
        label: "Teams",
        icon: Rows,
        to: (l, s) => `/${l.slug}/${s}/teams`,
        end: true,
      },
      {
        key: "rosters",
        label: "Rosters",
        icon: Columns,
        to: (l, s) => `/${l.slug}/${s}/teams/rosters`,
      },
    ],
  },
  {
    key: "transactions",
    label: "Transactions",
    icon: ArrowsLeftRight,
    children: [
      {
        key: "feed",
        label: "Trades & Waivers",
        icon: Handshake,
        to: (l, s) => `/${l.slug}/${s}/transactions`,
      },
      {
        key: "picks",
        label: "Future Picks",
        icon: Ticket,
        only: "dynasty",
        to: (l) => `/${l.slug}/picks`,
      },
    ],
  },
  {
    key: "draft",
    label: "Draft",
    icon: GridNine,
    to: (l, s) => `/${l.slug}/${s}/draft`,
  },
  {
    key: "records",
    label: "Records",
    icon: Ranking,
    children: [
      {
        key: "trophies",
        label: "Trophies",
        icon: Trophy,
        to: (l) => `/${l.slug}/records`,
        end: true,
      },
      {
        key: "overall",
        label: "Overall",
        icon: CalendarDots,
        to: (l) => `/${l.slug}/records/overall`,
      },
      {
        key: "single-season",
        label: "Single Season",
        icon: CalendarDot,
        to: (l) => `/${l.slug}/records/single-season`,
      },
      {
        key: "managers",
        label: "Managers",
        icon: UsersFour,
        to: (l) => `/${l.slug}/records/managers`,
      },
    ],
  },
];
