/* ============================================
 * Router 全局路由配置：用户端路由 + 后台子树
 * ============================================ */
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import MainLayout from '@/layouts/MainLayout';
import Home from '@/pages/Home';
import CanvasPage from '@/pages/CanvasPage';
import Projects from '@/pages/Projects';
import Assets from '@/pages/Assets';
import AccountCredits from '@/pages/AccountCredits';
import History from '@/pages/History';
import AuthSuccess from '@/pages/AuthSuccess';
import { adminRoutes } from '@/admin/router';
import { RequireAuth } from '@/router/guards';

const router = createBrowserRouter([
  {
    // 真人认证成功落地页：手机刷脸后由上游回调跳转，独立页面（无侧边栏/导航，无需产品登录态）
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
