"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

/**
 * Tooltip —— 通用 hover 文字提示。
 *
 * 为什么用 Portal 到 document.body：
 * 定位用 position:fixed + getBoundingClientRect()（视口坐标）。fixed 只在
 * 「无 transform 祖先」时才相对视口；只要祖先链上有人用了 CSS transform
 * （如居中用的 -translate-y-1/2），fixed 基准就被改成那个祖先，坐标错位。
 * Portal 直接挂到 body，避开整条祖先链的 transform / clipPath / overflow。
 *
 * 触发器事件通过 cloneElement 注入，不增加额外 DOM 层、不破坏调用方布局。
 * delay（IK56MS 工具栏）：悬停满 delay 毫秒才显示，期间移出则不显示；默认 0=即时。
 */
export function Tooltip({
  content,
  children,
  side = "right",
  gap = 10,
  delay = 0,
}: {
  content: string;
  children: ReactElement<{
    onMouseEnter?: (e: MouseEvent) => void;
    onMouseLeave?: () => void;
  }>;
  side?: "right" | "top" | "bottom";
  gap?: number;
  /** 延迟显示毫秒数（默认 0=即时）。 */
  delay?: number;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  // 卸载兜底：避免延迟计时器在组件销毁后触发 setState。
  useEffect(() => clearTimer, []);

  if (!isValidElement(children)) return children;

  // eslint-disable-next-line react-hooks/refs -- 注入的是 onMouseEnter/onMouseLeave 事件处理器，只在事件时读写 timer.current，渲染期不调用
  const trigger = cloneElement(children, {
    onMouseEnter: (e: MouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      if (!r) return;
      const next =
        side === "right"
          ? { x: r.right + gap, y: r.top + r.height / 2 }
          : side === "top"
            ? { x: r.left + r.width / 2, y: r.top - gap }
            : { x: r.left + r.width / 2, y: r.bottom + gap };
      clearTimer();
      if (delay > 0) {
        timer.current = setTimeout(() => setPos(next), delay);
      } else {
        setPos(next);
      }
    },
    onMouseLeave: () => {
      clearTimer();
      setPos(null);
    },
  });

  if (typeof document === "undefined") return trigger;

  return (
    <>
      {trigger}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y,
              transform:
                side === "right"
                  ? "translateY(-50%)"
                  : side === "top"
                    ? "translate(-50%, -100%)"
                    : "translate(-50%, 0)",
              zIndex: 9999,
              pointerEvents: "none",
              padding: "6px 10px",
              borderRadius: 6,
              background: "rgba(0, 0, 0, 0.85)",
              color: "rgba(255, 255, 255, 0.92)",
              fontSize: 11,
              lineHeight: 1.4,
              whiteSpace: "nowrap",
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
