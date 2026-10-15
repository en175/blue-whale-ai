import type { ReactElement } from 'react';
import { useSyncExternalStore } from 'react';
import { Navigate } from 'react-router-dom';
import { isAdmin, isLoggedIn, subscribe } from '@/shared/utils/auth';

interface GuardProps {
  children: ReactElement;
}

export function RequireAuth({ children }: GuardProps) {
  const ok = useSyncExternalStore(subscribe, isLoggedIn);
  if (!ok) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function RequireAdmin({ children }: GuardProps) {
  const ok = useSyncExternalStore(subscribe, isAdmin);
  if (!ok) {
    return <Navigate to="/" replace />;
  }
  return children;
}
