import { useCallback, useMemo, useRef, type RefObject, type TouchEvent, type UIEvent, type WheelEvent } from 'react';

const NEAR_BOTTOM_PX = 24;

export function useStickToBottom(ref: RefObject<HTMLElement | null>) {
  const pinnedRef = useRef(true);
  const lastTopRef = useRef(0);
  const touchYRef = useRef<number | null>(null);

  const follow = useCallback(() => {
    const el = ref.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
    lastTopRef.current = el.scrollTop;
  }, [ref]);

  const pin = useCallback(() => {
    pinnedRef.current = true;
    follow();
  }, [follow]);

  const handlers = useMemo(
    () => ({
      onWheel: (e: WheelEvent<HTMLElement>) => {
        if (e.deltaY < 0) pinnedRef.current = false;
      },
      onTouchStart: (e: TouchEvent<HTMLElement>) => {
        touchYRef.current = e.touches[0]?.clientY ?? null;
      },
      onTouchMove: (e: TouchEvent<HTMLElement>) => {
        const y = e.touches[0]?.clientY;
        if (y === undefined) return;
        if (touchYRef.current !== null && y > touchYRef.current) pinnedRef.current = false;
        touchYRef.current = y;
      },
      onScroll: (e: UIEvent<HTMLElement>) => {
        const el = e.currentTarget;
        const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (gap <= 1) pinnedRef.current = true;
        else if (el.scrollTop < lastTopRef.current) pinnedRef.current = false;
        else if (gap < NEAR_BOTTOM_PX) pinnedRef.current = true;
        lastTopRef.current = el.scrollTop;
      },
    }),
    [],
  );

  return { handlers, follow, pin };
}
