import {
  ArrowsLeftRight,
  Article,
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
import { RouteData } from "../types";
import { HomePage } from "./pages/Home.page";
import OverallRecordsPage from "./pages/OverallRecords.page";

const routes: RouteData[] = [
  {
    path: "/:leagueId",
    title: "Home",
    element: <HomePage />,
    navbarProperties: {
      icon: House,
    },
  },
  {
    path: "/:leagueId/blog",
    title: "Blog",
    element: <HomePage />,
    navbarProperties: {
      icon: Article,
      isDisabled: () => true,
    },
  },
  {
    path: "/:leagueId/standings",
    title: "Standings",
    element: <HomePage />,
    navbarProperties: {
      icon: ListNumbers,
    },
  },
  {
    path: "/:leagueId/matchups",
    title: "Matchups",
    element: <HomePage />,
    navbarProperties: {
      icon: FootballHelmet,
    },
  },
  {
    path: "/:leagueId/teams",
    title: "Teams",
    navbarProperties: {
      icon: UsersThree,
    },
    children: [
      {
        path: "/:leagueId/teams",
        title: "Divisions",
        element: <HomePage />,
        navbarProperties: {
          icon: Rows,
        },
      },
      {
        path: "/:leagueId/teams/rosters",
        title: "Rosters",
        element: <HomePage />,
        navbarProperties: {
          icon: Columns,
        },
      },
    ],
  },
  {
    path: "/:leagueId/transactions",
    title: "Transactions",
    navbarProperties: {
      icon: ArrowsLeftRight,
    },
    children: [
      {
        path: "/:leagueId/transactions",
        title: "Trades & Waivers",
        element: <HomePage />,
        navbarProperties: {
          icon: Handshake,
        },
      },
      {
        path: "/:leagueId/transactions/picks",
        title: "Future Picks",
        element: <HomePage />,
        navbarProperties: {
          icon: Ticket,
          isAvailable: (type) => type.type === "dynasty",
        },
      },
    ],
  },
  {
    path: "/:leagueId/draft",
    title: "Draft",
    element: <HomePage />,
    navbarProperties: {
      icon: GridNine,
    },
  },
  {
    path: "/:leagueId/records",
    title: "Records",
    navbarProperties: {
      icon: Ranking,
    },
    children: [
      {
        path: "/:leagueId/records",
        title: "Trophies",
        element: <HomePage />,
        navbarProperties: {
          icon: Trophy,
        },
      },
      {
        path: "/:leagueId/records/overall",
        title: "Overall",
        element: <OverallRecordsPage />,
        navbarProperties: {
          icon: CalendarDots,
        },
      },
      {
        path: "/:leagueId/records/single",
        title: "Single Season",
        element: <HomePage />,
        navbarProperties: {
          icon: CalendarDot,
        },
      },
      {
        path: "/:leagueId/records/managers",
        title: "Managers",
        element: <HomePage />,
        navbarProperties: {
          icon: UsersFour,
        },
      },
    ],
  },
];

export default routes;
