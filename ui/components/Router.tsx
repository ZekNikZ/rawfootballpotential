import { createBrowserRouter, Navigate, RouteObject, RouterProvider } from "react-router-dom";
import { RouteData } from "../../types";
import routes from "../routes";
import Layout from "./Layout";
import NavigateToLeagueHome from "./NavigateToLeagueHome";
import { CurrentLeagueProvider } from "../providers/current-league";

function routeDataToRoute(routeData: RouteData): RouteObject {
  const { path, element, children } = routeData;
  return { path, element, children: children?.map(routeDataToRoute) };
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <NavigateToLeagueHome />,
  },
  {
    path: "/:leagueId",
    element: (
      <CurrentLeagueProvider>
        <Layout />
      </CurrentLeagueProvider>
    ),
    errorElement: <Navigate replace to="/" />,
    children: [...routes.map(routeDataToRoute)],
  },
]);

export function Router() {
  return <RouterProvider router={router} />;
}
