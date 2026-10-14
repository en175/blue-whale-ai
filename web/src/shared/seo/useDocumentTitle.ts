import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { titleForPath } from './site';

export function useDocumentTitle(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleForPath(pathname);
  }, [pathname]);
}
