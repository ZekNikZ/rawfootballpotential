import { createBrowserRouter, Navigate, RouteObject, RouterProvider } from 'react-router-dom';
import Layout from './Layout';
import routes, { RouteData } from '../routes';

function routeDataToRoute(routeData: RouteData): RouteObject {
  const { path, element, children } = routeData;
  return { path, element, children: children?.map(routeDataToRoute) };
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <Navigate replace to="/" />,
    children: [...routes.map(routeDataToRoute)],
  },
]);

export function Router() {
  return <RouterProvider router={router} />;
}
