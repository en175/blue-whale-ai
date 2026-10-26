import { Suspense } from 'react';

export function LazyPage({ children }: { children: React.ReactElement }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
