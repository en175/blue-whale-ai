/* ============================================
 * Router 全局路由配置：用户端路由 + 后台子树
 * ============================================ */
import { createBrowserRouter, Navigate } from 'react-router-dom';
import MainLayout from '@/layouts/MainLayout';
import Home from '@/pages/Home';
import CanvasPage from '@/pages/CanvasPage';
import Projects from '@/pages/Projects';
import Assets from '@/pages/Assets';
import { adminRoutes } from '@/admin/router';

const router = createBrowserRouter([
  {
    path: '/',
    element: <MainLayout />,
    children: [
      {
        index: true,
        element: <Home />,
      },
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
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
  adminRoutes,
]);

export default router;
