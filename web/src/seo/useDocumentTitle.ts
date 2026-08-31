/* ============================================
 * 随路由切换 document.title，避免 SPA 切页后仍显示首页标题
 * ============================================ */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { titleForPath } from './site';

export function useDocumentTitle(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleForPath(pathname);
  }, [pathname]);
}
