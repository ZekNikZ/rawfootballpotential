import { Suspense } from "react";
import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { leaguesQuery } from "../api/queries";
import { ErrorPage } from "../components/ErrorPage";
import { ShellSkeleton } from "../components/ShellSkeleton";
import { Layout } from "./Layout";

/** `/` goes to the first league. */
function IndexRedirect() {
  const { data } = useSuspenseQuery(leaguesQuery());
  const first = data.leagues[0];
  return first ? (
    <Navigate to={`/${first.slug}`} replace />
  ) : (
    <ErrorPage message="No leagues are set up yet." />
  );
}

const lazyPage = (load: () => Promise<{ default: React.ComponentType }>) => ({
  lazy: async () => ({ Component: (await load()).default }),
});

const leagueRoutes: RouteObject[] = [
  { index: true, handle: { title: "Home" }, ...lazyPage(() => import("../pages/Home")) },
  {
    path: "records",
    children: [
      {
        index: true,
        handle: { title: "Trophies" },
        ...lazyPage(() => import("../pages/Trophies")),
      },
      {
        path: "overall",
        handle: { title: "Overall Records" },
        ...lazyPage(() => import("../pages/OverallRecords")),
      },
      {
        path: "single-season",
        handle: { title: "Single Season Records" },
        ...lazyPage(() => import("../pages/SingleSeasonRecords")),
      },
      {
        path: "managers",
        handle: { title: "Manager Records" },
        ...lazyPage(() => import("../pages/ManagerRecords")),
      },
    ],
  },
  {
    path: "franchises/:franchise",
    handle: { title: "Franchise" },
    ...lazyPage(() => import("../pages/FranchiseProfile")),
  },
  // Pages that arrive later still resolve (nav shows them as "Soon"), so a pasted link isn't a 404.
  {
    path: "picks",
    handle: { title: "Future Picks" },
    ...lazyPage(() => import("../pages/ComingSoon")),
  },
  {
    path: ":season/:page",
    handle: { title: "Coming soon" },
    ...lazyPage(() => import("../pages/ComingSoon")),
  },
  { path: "*", handle: { title: "Not found" }, ...lazyPage(() => import("../pages/NotFound")) },
];

// The admin area is its own lazy chunk: public visitors never download it.
const adminRoutes: RouteObject[] = [
  { path: "login", ...lazyPage(() => import("../admin/Login")) },
  { path: "accept", ...lazyPage(() => import("../admin/Accept")) },
  {
    ...lazyPage(() => import("../admin/AdminShell")),
    children: [
      { index: true, ...lazyPage(() => import("../admin/Overview")) },
      { path: "site", ...lazyPage(() => import("../admin/SitePage")) },
      { path: "leagues", ...lazyPage(() => import("../admin/LeaguesPage")) },
      { path: "people", ...lazyPage(() => import("../admin/PeoplePage")) },
      { path: "corrections", ...lazyPage(() => import("../admin/CorrectionsPage")) },
      { path: "thresholds", ...lazyPage(() => import("../admin/ThresholdsPage")) },
      { path: "players", ...lazyPage(() => import("../admin/PlayersPage")) },
      { path: "records", ...lazyPage(() => import("../admin/RecordSettingsPage")) },
      { path: "jobs", ...lazyPage(() => import("../admin/JobsPage")) },
      { path: "import", ...lazyPage(() => import("../admin/ImportPage")) },
      { path: "users", ...lazyPage(() => import("../admin/UsersPage")) },
      { path: "audit", ...lazyPage(() => import("../admin/AuditPage")) },
    ],
  },
];

export const routes: RouteObject[] = [
  {
    path: "/",
    errorElement: <ErrorPage />,
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<ShellSkeleton />}>
            <IndexRedirect />
          </Suspense>
        ),
      },
      { path: "admin", children: adminRoutes },
      {
        path: ":league",
        element: (
          <Suspense fallback={<ShellSkeleton />}>
            <Layout />
          </Suspense>
        ),
        children: leagueRoutes,
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
