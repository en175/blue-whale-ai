/**
 * ZoomControls —— 画布右下角缩放控件（展示层）
 * 提供放大/缩小/复位等操作，按当前 viewport 与容器尺寸计算并回写 setViewport。
 */
import { useCallback } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import type { Viewport } from "../types";

export function ZoomControls({
  containerRef,
  viewport,
  setViewport,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
}) {
  const zoomBy = useCallback(
    (factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = rect ? rect.width / 2 : 0;
      const cy = rect ? rect.height / 2 : 0;
      const worldX = (cx - viewport.x) / viewport.scale;
      const worldY = (cy - viewport.y) / viewport.scale;
      const newScale = Math.min(3, Math.max(0.1, viewport.scale * factor));
      setViewport({
        x: cx - worldX * newScale,
        y: cy - worldY * newScale,
        scale: newScale,
      });
    },
    [containerRef, viewport, setViewport]
  );

  return (
    <div className="tc-ui-fade-in absolute bottom-4 right-4 z-[150] opacity-100">
      <div className="tc-bottom-right-panel flex items-center gap-1 rounded-[18px] bg-[#171717] p-1 border border-white/[0.04]">
        <div className="flex items-center">
          <button
            type="button"
            aria-label="缩小"
            onClick={() => zoomBy(0.9)}
            className="tc-ui-glow-btn flex h-7 w-7 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/[0.08]"
          >
            <Minus width={12} height={12} />
          </button>
          <button
            type="button"
            aria-label="缩放 100%"
            aria-expanded="false"
            className="tc-ui-glow-btn inline-flex h-7 w-16 items-center justify-end gap-1.5 rounded-lg px-1.5 text-xs font-medium text-white/95 transition-colors hover:bg-white/[0.08]"
          >
            <span className="relative z-[1] flex-1 text-right">{Math.round(viewport.scale * 100)}%</span>
            <ChevronDown width={11} height={11} stroke="rgba(255,255,255,0.8)" />
          </button>
          <button
            type="button"
            aria-label="放大"
            onClick={() => zoomBy(1.1)}
            className="tc-ui-glow-btn flex h-7 w-7 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/[0.08]"
          >
            <Plus width={12} height={12} />
          </button>
        </div>
        <div className="mx-0.5 h-4 w-px bg-white/[0.06]" />
        <button
          type="button"
          aria-label="键盘快捷键"
          className="tc-ui-glow-btn flex h-7 w-7 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/[0.08]"
        >
          <svg
            width={18}
            height={18}
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="block"
          >
            <rect x="2" y="5" width="14" height="10" rx="1.5" />
            <line x1="5" y1="12" x2="13" y2="12" />
            <line x1="5" y1="8" x2="5" y2="8.01" />
            <line x1="9" y1="8" x2="9" y2="8.01" />
            <line x1="13" y1="8" x2="13" y2="8.01" />
          </svg>
        </button>
      </div>
    </div>
  );
}
