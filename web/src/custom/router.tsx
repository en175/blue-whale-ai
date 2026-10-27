import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { useAuthStore } from '@/shared/stores/auth';
import MainLayout from '@/custom/layouts/MainLayout';
import Home from '@/custom/pages/Home';
import CanvasPage from '@/custom/pages/CanvasPage';
import Projects from '@/custom/pages/Projects';
import Assets from '@/custom/pages/Assets';
import AccountCredits from '@/custom/pages/AccountCredits';
import History from '@/custom/pages/History';
import AuthSuccess from '@/custom/pages/AuthSuccess';
import LoginDialog from '@/custom/components/LoginDialog';
import { adminRoutes } from '@/shared/router/adminRoutes';
import { RequireAuth } from '@/shared/router/guards';

function AccountScopedOutlet() {
  const userId = useAuthStore((state) => state.user?.userId ?? null);
  return <Outlet key={userId ?? 'guest'} />;
}

function LoginDialogRoute() {
  return (
    <>
      <LoginDialog />
      <Outlet />
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <LoginDialogRoute />,
    children: [
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
                <AccountScopedOutlet />
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
    ],
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
