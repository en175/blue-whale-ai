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
  const hasInterfaceBackground = isHomePage ? false : hasGlassBackground;

  return (
    <div className={`${styles.layout} ${isHomePage ? styles.homeLayout : ''} ${isHomePage && homeSidebarExpanded ? styles.layoutWideSidebar : ''}`}>
      {!isCanvasPage && !isHomePage && <Sidebar />}
      {!isCanvasPage && isHomePage && (
        <HomeSidebar expanded={homeSidebarExpanded} onExpandedChange={setHomeSidebarExpanded} />
      )}
      <main className={`${styles.main} ${isCanvasPage ? styles.mainFull : ''} ${hasInterfaceBackground ? styles.mainGlass : ''}`}>
        {hasInterfaceBackground && <HeroVideoCarousel />}
        <Outlet />
      </main>
    </div>
  );
}
