import { useEffect, type RefObject } from "react";

/**
 * 点击 Dock 外部区域时触发 onClose（IK5OWS）。
 * 三项例外：picking 模式 / data-tc-dock-popover 浮层 / 左侧工具栏。
 */
export function useDockClickOutside(
  dockRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  { isOpen, isPicking }: { isOpen: boolean; isPicking: boolean },
) {
  useEffect(() => {
    if (!isOpen || isPicking) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (dockRef.current?.contains(target)) return;
      if (target instanceof Element) {
        if (target.closest("[data-tc-dock-popover]")) return;
        if (target.closest('[data-tour-target="creation-sidebar"]')) return;
      }
      onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen, isPicking, onClose, dockRef]);
}
