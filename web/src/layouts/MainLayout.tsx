/* ============================================
 * MainLayout 全局布局：左侧导航栏 + 页面出口
 * ============================================ */
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';
import styles from './index.module.css';

export default function MainLayout() {
  const location = useLocation();
  const isCanvasPage = location.pathname === '/canvas';

  return (
    <div className={styles.layout}>
      {!isCanvasPage && <Sidebar />}
      <main className={`${styles.main} ${isCanvasPage ? styles.mainFull : ''}`}>
        <Outlet />
      </main>
    </div>
  );
}
