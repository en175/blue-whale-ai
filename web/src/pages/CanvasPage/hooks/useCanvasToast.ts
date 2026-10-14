import { useCallback, useRef, useState } from 'react';

export type CanvasToastKind = 'success' | 'error' | 'warn';
export type CanvasToastState = { type: CanvasToastKind; msg: string };

export function useCanvasToast() {
  const [toast, setToast] = useState<CanvasToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((type: CanvasToastKind, msg: string) => {
    setToast({ type, msg });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
  }, []);
  return { toast, showToast };
}
