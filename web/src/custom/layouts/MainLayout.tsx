import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import HomeSidebar from '@/custom/pages/Home/components/HomeSidebar';
import { useDocumentTitle } from '@/shared/seo/useDocumentTitle';
import styles from './index.module.css';

export default function MainLayout() {
  const location = useLocation();
  const [homeSidebarExpanded, setHomeSidebarExpanded] = useState(false);
  useDocumentTitle();
  const isCanvasPage = location.pathname === '/canvas';

  useEffect(() => {
    setHomeSidebarExpanded(false);
  }, [location.pathname]);

  return (
    <div
      className={`${styles.layout} ${homeSidebarExpanded ? styles.layoutWideSidebar : ''}`}
      data-sidebar={isCanvasPage ? 'none' : homeSidebarExpanded ? 'wide' : 'compact'}
    >
      {!isCanvasPage && <HomeSidebar expanded={homeSidebarExpanded} onExpandedChange={setHomeSidebarExpanded} />}
      <main className={`${styles.main} ${isCanvasPage ? styles.mainFull : ''}`}>
        <Outlet />
      </main>
    </div>
  );
}
