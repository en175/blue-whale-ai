import type { ReactElement } from 'react';
import { useEffect, useSyncExternalStore } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { isAdmin, isLoggedIn, subscribe } from '@/shared/utils/auth';
import { useLoginDialogStore } from '@/shared/stores/loginDialog';

export interface LoginRedirect {
  returnTo: string | null;
  state: unknown;
}

export function resolveLoginRedirect(pathname: string, search: string, state: unknown): LoginRedirect {
  if (pathname === '/' || pathname.startsWith('/admin')) {
    return { returnTo: null, state };
  }
  return { returnTo: `${pathname}${search}`, state };
}

function useLoginRedirect(): boolean {
  const navigate = useNavigate();
  const location = useLocation();
  const loggedIn = useSyncExternalStore(subscribe, isLoggedIn);
  useEffect(() => {
    if (loggedIn) return;
    const redirect = resolveLoginRedirect(location.pathname, location.search, location.state);
    useLoginDialogStore.getState().openLogin({ returnTo: redirect.returnTo ?? undefined });
    navigate('/', { state: redirect.state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, location.pathname, location.search, location.state, navigate]);
  return loggedIn;
}

export function RequireAuth({ children }: { children: ReactElement }) {
  return useLoginRedirect() ? children : null;
}

export default function RequireAdmin({ children }: { children: ReactElement }) {
  const loggedIn = useLoginRedirect();
  if (!loggedIn) return null;
  return isAdmin() ? children : <Navigate to="/" replace />;
}
