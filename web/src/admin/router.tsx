/* ============================================
 * admin 子路由表：后台页面，按需懒加载
 * ============================================ */
import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import RequireAdmin from '@/router/guards';
import AdminLayout from './layouts/AdminLayout';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const RechargePlans = lazy(() => import('./pages/RechargePlans'));
const TemplateManage = lazy(() => import('./pages/TemplateManage'));
const SkillManage = lazy(() => import('./pages/SkillManage'));
const ModelList = lazy(() => import('./pages/ModelList'));
const UserManage = lazy(() => import('./pages/UserManage'));
const OperationLog = lazy(() => import('./pages/OperationLog'));
const SystemConfig = lazy(() => import('./pages/SystemConfig'));
const SiteConfig = lazy(() => import('./pages/SiteConfig'));

/** 懒加载包裹 */
function L({ children }: { children: React.ReactElement }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

/** 后台路由子树（挂载到根路由） */
export const adminRoutes = {
  path: '/admin',
  element: (
    <RequireAdmin>
      <AdminLayout />
    </RequireAdmin>
  ),
  children: [
    { index: true, element: <L><Dashboard /></L> },
    { path: 'recharge-plans', element: <L><RechargePlans /></L> },
    { path: 'templates', element: <L><TemplateManage /></L> },
    { path: 'skills', element: <L><SkillManage /></L> },
    { path: 'models', element: <L><ModelList /></L> },
    { path: 'users', element: <L><UserManage /></L> },
    { path: 'logs', element: <L><OperationLog /></L> },
    { path: 'site-config', element: <L><SiteConfig /></L> },
    { path: 'settings', element: <L><SystemConfig /></L> },
    { path: '*', element: <Navigate to="/admin" replace /> },
  ],
};
