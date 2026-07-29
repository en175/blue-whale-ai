"use client";
/**
 * useResponsive — 响应式断点检测 hook
 *
 * 监听 matchMedia 变化，返回当前是否为移动端视口。
 * SSR 安全：无 window 时返回 false。
 */
import { useEffect, useState } from "react";
import { MOBILE_BREAKPOINT } from "./constants";

export function useResponsive() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

    // 初始化
    setIsMobile(mql.matches);

    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return { isMobile };
}
