/* ============================================
 * guards 路由守卫：RequireAdmin 管理员角色校验
 * ============================================ */
import type { ReactElement } from 'react';
import { useSyncExternalStore } from 'react';
import { Navigate } from 'react-router-dom';
import { isAdmin, subscribe } from '@/utils/auth';

interface RequireAdminProps {
  children: ReactElement;
}

/** 非管理员访问后台路由时重定向回首页（登录态变化实时生效） */
export default function RequireAdmin({ children }: RequireAdminProps) {
  const ok = useSyncExternalStore(subscribe, isAdmin);
  if (!ok) {
    return <Navigate to="/" replace />;
  }
  return children;
}
