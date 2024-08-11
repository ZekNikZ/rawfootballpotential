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

const routes: RouteData[] = [
  {
    path: "/",
    title: "Home",
    element: <HomePage />,
    navbarProperties: {
      icon: House,
    },
  },
  {
    path: "/blog",
    title: "Blog",
    element: <HomePage />,
    navbarProperties: {
      icon: Article,
      isDisabled: () => true,
    },
  },
  {
    path: "/standings",
    title: "Standings",
    element: <HomePage />,
    navbarProperties: {
      icon: ListNumbers,
    },
  },
  {
    path: "/matchups",
    title: "Matchups",
    element: <HomePage />,
    navbarProperties: {
      icon: FootballHelmet,
    },
  },
  {
    path: "/teams",
    title: "Teams",
    element: <HomePage />,
    navbarProperties: {
      icon: UsersThree,
    },
    children: [
      {
        path: "/teams",
        title: "Divisions",
        element: <HomePage />,
        navbarProperties: {
          icon: Rows,
        },
      },
      {
        path: "/teams/rosters",
        title: "Rosters",
        element: <HomePage />,
        navbarProperties: {
          icon: Columns,
        },
      },
    ],
  },
  {
    path: "/transactions",
    title: "Transactions",
    element: <HomePage />,
    navbarProperties: {
      icon: ArrowsLeftRight,
    },
    children: [
      {
        path: "/transactions",
        title: "Trades & Waivers",
        element: <HomePage />,
        navbarProperties: {
          icon: Handshake,
        },
      },
      {
        path: "/transactions/picks",
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
    path: "/draft",
    title: "Draft",
    element: <HomePage />,
    navbarProperties: {
      icon: GridNine,
    },
  },
  {
    path: "/records",
    title: "Records",
    element: <HomePage />,
    navbarProperties: {
      icon: Ranking,
    },
    children: [
      {
        path: "/records",
        title: "Trophies",
        element: <HomePage />,
        navbarProperties: {
          icon: Trophy,
        },
      },
      {
        path: "/records/overall",
        title: "Overall",
        element: <HomePage />,
        navbarProperties: {
          icon: CalendarDots,
        },
      },
      {
        path: "/records/single",
        title: "Single Season",
        element: <HomePage />,
        navbarProperties: {
          icon: CalendarDot,
        },
      },
      {
        path: "/records/managers",
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
