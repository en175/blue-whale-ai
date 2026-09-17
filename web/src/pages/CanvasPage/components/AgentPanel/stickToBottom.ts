import { useCallback, useMemo, useRef, type RefObject, type TouchEvent, type UIEvent, type WheelEvent } from 'react';

/** 离底部这么近，算用户滑回了底部。 */
const NEAR_BOTTOM_PX = 24;

/**
 * 消息列表跟随到底：用户贴着底时新内容进来就跟到底，用户往上翻了就不再拉他回去。
 *
 * 此前内容一变就无条件滚到底，运行中每来一段流式正文都触发一次，用户往上滑刚动一下就被拽回最后一行。
 *
 * 「翻上去了」看的是用户的动作，不是离底部多远：只按距离判断的话，滑一小格还在阈值以内，下一段内容一来
 * 照样被拉回去，输出越快越明显。滚轮往上、手指往下拖、滚动位置变小，任何一个都算。滑回底部附近才恢复跟随。
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>) {
  const pinnedRef = useRef(true);
  const lastTopRef = useRef(0);
  const touchYRef = useRef<number | null>(null);

  /** 内容变了：贴着底就跟到底，翻上去了不动。 */
  const follow = useCallback(() => {
    const el = ref.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
    lastTopRef.current = el.scrollTop;
  }, [ref]);

  /** 用户发了新消息、切了会话：不管在哪，回到底部并恢复跟随。 */
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
        // 手指往下拖 = 内容往回翻
        if (touchYRef.current !== null && y > touchYRef.current) pinnedRef.current = false;
        touchYRef.current = y;
      },
      onScroll: (e: UIEvent<HTMLElement>) => {
        const el = e.currentTarget;
        const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
        // 顺序有讲究：先认「就在底部」（内容变短被浏览器压回底部也会变小），再认「往上翻了」，
        // 最后才是「滑到了底部附近」——否则往上滑一小格还在阈值内，会被当成贴底。
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
