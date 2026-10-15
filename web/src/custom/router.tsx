import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import MainLayout from '@/custom/layouts/MainLayout';
import Home from '@/custom/pages/Home';
import CanvasPage from '@/custom/pages/CanvasPage';
import Projects from '@/custom/pages/Projects';
import Assets from '@/custom/pages/Assets';
import AccountCredits from '@/custom/pages/AccountCredits';
import History from '@/custom/pages/History';
import AuthSuccess from '@/custom/pages/AuthSuccess';
import { adminRoutes } from '@/admin/router';
import { RequireAuth } from '@/shared/router/guards';

const router = createBrowserRouter([
  {
    path: '/auth-success',
    element: <AuthSuccess />,
  },
  {
    path: '/account/credits',
    element: (
      <RequireAuth>
        <AccountCredits />
      </RequireAuth>
    ),
  },
  {
    path: '/',
    element: <MainLayout />,
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        element: (
          <RequireAuth>
            <Outlet />
          </RequireAuth>
        ),
        children: [
          {
            path: 'canvas',
            element: <CanvasPage />,
          },
          {
            path: 'projects',
            element: <Projects />,
          },
          {
            path: 'library',
            element: <Assets />,
          },
          {
            path: 'history',
            element: <History />,
          },
        ],
      },
      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
  adminRoutes,
]);

export default router;
