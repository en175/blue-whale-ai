import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '@/custom/components/Sidebar';
import HomeSidebar from '@/custom/pages/Home/components/HomeSidebar';
import { useDocumentTitle } from '@/shared/seo/useDocumentTitle';
import HeroVideoCarousel from '@/custom/pages/Home/components/HeroVideoCarousel';
import styles from './index.module.css';

export default function MainLayout() {
  const location = useLocation();
  const [homeSidebarExpanded, setHomeSidebarExpanded] = useState(false);
  useDocumentTitle();
  const isCanvasPage = location.pathname === '/canvas';
  const isHomePage = location.pathname === '/';
  const hasGlassBackground = ['/', '/projects', '/library', '/history'].includes(location.pathname);

  return (
    <div className={`${styles.layout} ${isHomePage && homeSidebarExpanded ? styles.layoutWideSidebar : ''}`}>
      {!isCanvasPage && !isHomePage && <Sidebar />}
      {!isCanvasPage && isHomePage && (
        <HomeSidebar expanded={homeSidebarExpanded} onExpandedChange={setHomeSidebarExpanded} />
      )}
      <main className={`${styles.main} ${isCanvasPage ? styles.mainFull : ''} ${hasGlassBackground ? styles.mainGlass : ''}`}>
        {hasGlassBackground && <HeroVideoCarousel />}
        <Outlet />
      </main>
    </div>
  );
}
