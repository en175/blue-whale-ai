"use client";

import {
  cloneElement,
  isValidElement,
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
 */
export function Tooltip({
  content,
  children,
  side = "right",
  gap = 10,
}: {
  content: string;
  children: ReactElement<{ onMouseEnter?: (e: MouseEvent) => void; onMouseLeave?: () => void }>;
  side?: "right" | "top" | "bottom";
  gap?: number;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  if (!isValidElement(children)) return children;

  const trigger = cloneElement(children, {
    onMouseEnter: (e: MouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      if (!r) return;
      setPos(
        side === "right"
          ? { x: r.right + gap, y: r.top + r.height / 2 }
          : side === "top"
            ? { x: r.left + r.width / 2, y: r.top - gap }
            : { x: r.left + r.width / 2, y: r.bottom + gap }
      );
    },
    onMouseLeave: () => setPos(null),
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
          document.body
        )}
    </>
  );
}
