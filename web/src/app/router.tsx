import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import MainLayout from '@/app/layouts/MainLayout';
import Home from '@/app/pages/Home';
import CanvasPage from '@/app/pages/CanvasPage';
import Projects from '@/app/pages/Projects';
import Assets from '@/app/pages/Assets';
import AccountCredits from '@/app/pages/AccountCredits';
import History from '@/app/pages/History';
import AuthSuccess from '@/app/pages/AuthSuccess';
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
