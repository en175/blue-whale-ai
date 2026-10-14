import { useRef } from 'react';
import type { CanvasDoc } from '@/api/canvas';

export function useCanvasHydrationFlags() {
  const hydratedDocRef = useRef<CanvasDoc | null>(null);
  const hydratedProjectRef = useRef<string | null>(null);
  const confirmedNonEmptyRef = useRef(false);
  const emptyClearConflictRef = useRef(false);
  const emptyOverwriteRejectedRef = useRef(false);
  const recoverySaveConflictRef = useRef(false);
  const productSeq = useRef(0);
  const docLoadEpochRef = useRef<object>({});
  return {
    hydratedDocRef,
    hydratedProjectRef,
    confirmedNonEmptyRef,
    emptyClearConflictRef,
    emptyOverwriteRejectedRef,
    recoverySaveConflictRef,
    productSeq,
    docLoadEpochRef,
  };
}
