/* ============================================
 * admin 子路由表：后台 8 页，页面按需懒加载
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
const OrderManage = lazy(() => import('./pages/OrderManage'));
const OperationLog = lazy(() => import('./pages/OperationLog'));
const SystemConfig = lazy(() => import('./pages/SystemConfig'));

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
    { path: 'orders', element: <L><OrderManage /></L> },
    { path: 'logs', element: <L><OperationLog /></L> },
    { path: 'settings', element: <L><SystemConfig /></L> },
    { path: '*', element: <Navigate to="/admin" replace /> },
  ],
};
