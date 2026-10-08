import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';
import { useDocumentTitle } from '@/seo/useDocumentTitle';
import HeroVideoCarousel from '@/pages/Home/components/HeroVideoCarousel';
import styles from './index.module.css';

export default function MainLayout() {
  const location = useLocation();
  useDocumentTitle();
  const isCanvasPage = location.pathname === '/canvas';
  const hasGlassBackground = ['/', '/projects', '/library', '/history'].includes(location.pathname);

  return (
    <div className={styles.layout}>
      {!isCanvasPage && <Sidebar />}
      <main className={`${styles.main} ${isCanvasPage ? styles.mainFull : ''} ${hasGlassBackground ? styles.mainGlass : ''}`}>
        {hasGlassBackground && <HeroVideoCarousel />}
        <Outlet />
      </main>
    </div>
  );
}
