import {
  IconArticle,
  IconChartBar,
  IconClock,
  IconColumns3,
  IconHome,
  IconLayoutList,
  IconListNumbers,
  IconScale,
  IconTicket,
  IconTransfer,
  IconTrophy,
  IconUser,
  IconUsersGroup,
  IconVs,
  TablerIconsProps,
} from '@tabler/icons-react';
import { HomePage } from './Home.page';
import { BlogPage } from './Blog.page';
import { StandingsPage } from './Standings.pages';
import { LeagueDefinition } from '../leaguesData';
import { MatchupsPage } from './Matchups.pages';

export interface RouteData {
  path: string;
  title: string;
  element: React.ReactNode;
  navbarProperties?: {
    label?: string;
    icon: React.ReactNode;
    shouldHighlight?: (pathname: string) => boolean;
    isAvailable?: (league: LeagueDefinition) => boolean;
  };
  children?: RouteData[];
}

export function makeIcon(Icon: React.FC<TablerIconsProps>): React.ReactNode {
  return <Icon size="1rem" stroke={1.5} />;
}

const routes: RouteData[] = [
  {
    path: '/',
    title: 'Home',
    element: <HomePage />,
    navbarProperties: {
      icon: makeIcon(IconHome),
    },
  },
  {
    path: '/blog',
    title: 'Blog',
    element: <BlogPage />,
    navbarProperties: {
      icon: makeIcon(IconArticle),
    },
  },
  {
    path: '/standings',
    title: 'Standings',
    element: <StandingsPage />,
    navbarProperties: {
      icon: makeIcon(IconListNumbers),
    },
  },
  {
    path: '/matchups',
    title: 'Matchups',
    element: <MatchupsPage />,
    navbarProperties: {
      icon: makeIcon(IconVs),
    },
  },
  {
    path: '/teams',
    title: 'Teams',
    element: <HomePage />,
    navbarProperties: {
      icon: makeIcon(IconUsersGroup),
    },
    children: [
      {
        path: '/teams',
        title: 'Divisions',
        element: <HomePage />,
        navbarProperties: {
          icon: makeIcon(IconLayoutList),
          shouldHighlight: (pathname) =>
            pathname.startsWith('/teams/') && !pathname.endsWith('/compare'),
        },
      },
      {
        path: '/teams/:teamId',
        title: 'Team Info',
        element: <HomePage />,
      },
      {
        path: '/teams/compare',
        title: 'Compare',
        element: <HomePage />,
        navbarProperties: {
          icon: makeIcon(IconScale),
        },
      },
    ],
  },
  {
    path: '/transactions',
    title: 'Transactions',
    element: <HomePage />,
    navbarProperties: {
      icon: makeIcon(IconTransfer),
    },
    children: [
      {
        path: '/transactions',
        title: 'Trades & Waivers',
        element: <HomePage />,
        navbarProperties: {
          icon: makeIcon(IconTransfer),
        },
      },
      {
        path: '/transactions/picks',
        title: 'Future Picks',
        element: <HomePage />,
        navbarProperties: {
          icon: makeIcon(IconTicket),
          isAvailable: (league) => league.type === 'dynasty',
        },
      },
    ],
  },
  {
    path: '/records',
    title: 'Records',
    element: <HomePage />,
    navbarProperties: {
      icon: makeIcon(IconChartBar),
    },
    children: [
      {
        path: '/records',
        title: 'Leaderboards',
        element: <HomePage />,
        navbarProperties: {
          icon: makeIcon(IconTrophy),
        },
      },
      {
        path: '/records/drafts',
        title: 'Drafts',
        element: <HomePage />,
        navbarProperties: {
          icon: makeIcon(IconColumns3),
        },
      },
      {
        path: '/records/managers',
        title: 'Managers',
        element: <HomePage />,
        navbarProperties: {
          icon: makeIcon(IconUser),
        },
      },
      {
        path: '/records/previous-seasons',
        title: 'Previous Seasons',
        element: <HomePage />,
        navbarProperties: {
          icon: makeIcon(IconClock),
        },
      },
    ],
  },
];

export default routes;
