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
  MathOperations,
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
import ManagerRecordsPage from "./pages/ManagerRecords.page";
import SingleSeasonRecordsPage from "./pages/SingleSeasonRecords.page";
import MathTestPage from "./pages/MathTest.page";

const SHOW_UNAVAILABLE = false;

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
    path: "/:leagueId/standings",
    title: "Standings",
    element: <HomePage />,
    navbarProperties: {
      icon: ListNumbers,
      isDisabled: () => true,
      isAvailable: () => SHOW_UNAVAILABLE,
    },
  },
  {
    path: "/:leagueId/matchups",
    title: "Matchups",
    element: <HomePage />,
    navbarProperties: {
      icon: FootballHelmet,
      isDisabled: () => true,
      isAvailable: () => SHOW_UNAVAILABLE,
    },
  },
  {
    path: "/:leagueId/teams",
    title: "Teams",
    navbarProperties: {
      icon: UsersThree,
      isDisabled: () => true,
      isAvailable: () => SHOW_UNAVAILABLE,
    },
    children: [
      {
        path: "/:leagueId/teams",
        title: "Divisions",
        element: <HomePage />,
        navbarProperties: {
          icon: Rows,
          isAvailable: () => SHOW_UNAVAILABLE,
        },
      },
      {
        path: "/:leagueId/teams/rosters",
        title: "Rosters",
        element: <HomePage />,
        navbarProperties: {
          icon: Columns,
          isAvailable: () => SHOW_UNAVAILABLE,
        },
      },
    ],
  },
  {
    path: "/:leagueId/transactions",
    title: "Transactions",
    navbarProperties: {
      icon: ArrowsLeftRight,
      isDisabled: () => true,
      isAvailable: () => SHOW_UNAVAILABLE,
    },
    children: [
      {
        path: "/:leagueId/transactions",
        title: "Trades & Waivers",
        element: <HomePage />,
        navbarProperties: {
          icon: Handshake,
          isAvailable: () => SHOW_UNAVAILABLE,
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
      isDisabled: () => true,
      isAvailable: () => SHOW_UNAVAILABLE,
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
          isDisabled: () => true,
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
        element: <SingleSeasonRecordsPage />,
        navbarProperties: {
          icon: CalendarDot,
          isDisabled: () => true,
        },
      },
      {
        path: "/:leagueId/records/managers",
        title: "Managers",
        element: <ManagerRecordsPage />,
        navbarProperties: {
          icon: UsersFour,
        },
      },
    ],
  },
  {
    path: "/:leagueId/math-test",
    title: "Math Test",
    element: <MathTestPage />,
    navbarProperties: {
      icon: MathOperations,
      isAvailable: () => SHOW_UNAVAILABLE,
    },
  },
];

export default routes;
