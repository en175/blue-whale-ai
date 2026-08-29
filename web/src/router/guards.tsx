/* ============================================
 * guards 路由守卫：登录态与管理员角色校验
 * ============================================ */
import type { ReactElement } from 'react';
import { useSyncExternalStore } from 'react';
import { Navigate } from 'react-router-dom';
import { isAdmin, isLoggedIn, subscribe } from '@/utils/auth';

interface GuardProps {
  children: ReactElement;
}

/** 未登录访问受保护页时重定向回首页（登录态变化实时生效） */
export function RequireAuth({ children }: GuardProps) {
  const ok = useSyncExternalStore(subscribe, isLoggedIn);
  if (!ok) {
    return <Navigate to="/" replace />;
  }
  return children;
}

/** 非管理员访问后台路由时重定向回首页（登录态变化实时生效） */
export default function RequireAdmin({ children }: GuardProps) {
  const ok = useSyncExternalStore(subscribe, isAdmin);
  if (!ok) {
    return <Navigate to="/" replace />;
  }
  return children;
}
