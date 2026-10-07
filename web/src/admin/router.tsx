/* ============================================
 * admin 子路由表：后台页面，按需懒加载
 * ============================================ */
import { Dashboard, RechargePlans, RechargeCustomConfig, Promotions, MemberDiscounts, RechargeRecords, ConsumptionRecords, JobRecords, TemplateManage, SkillManage, ModelList, UserManage, OperationLog, SystemConfig, SiteConfig } from './lazyPages';
import { LazyPage as L } from './LazyPage';
import { Navigate } from 'react-router-dom';
import RequireAdmin from '@/router/guards';
import AdminLayout from './layouts/AdminLayout';

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
    { path: 'recharge-custom-config', element: <L><RechargeCustomConfig /></L> },
    { path: 'billing-promotions', element: <L><Promotions /></L> },
    { path: 'billing-member-discounts', element: <L><MemberDiscounts /></L> },
    { path: 'recharge-records', element: <L><RechargeRecords /></L> },
    { path: 'consumption-records', element: <L><ConsumptionRecords /></L> },
    { path: 'job-records', element: <L><JobRecords /></L> },
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
