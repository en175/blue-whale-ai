/**
 * ZoomControls —— 画布右下角缩放控件（展示层，React Flow 驱动）
 *
 * 迁移自手算 viewport.scale。现由 RF `useReactFlow`（zoomIn/zoomOut/zoomTo）
 * + `useViewport`（读 zoom 百分比）驱动。须渲染在 `<ReactFlowProvider>` 内
 * （page.tsx 包裹 CanvasSurface + ZoomControls）。
 */
import { useCallback } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { useReactFlow, useViewport } from "@xyflow/react";

export function ZoomControls() {
  const { zoomIn, zoomOut, zoomTo } = useReactFlow();
  const { zoom } = useViewport();

  const handleReset = useCallback(() => {
    zoomTo(1);
  }, [zoomTo]);

  return (
    <div className="tc-ui-fade-in absolute bottom-4 right-4 z-[150] opacity-100">
      <div
        className="tc-bottom-right-panel flex items-center gap-1 rounded-[18px] p-1"
        style={{
          background: "var(--tc-menu-pill-bg)",
          border: "1px solid var(--tc-menu-pill-border)",
        }}
      >
        <div className="flex items-center">
          <button
            type="button"
            aria-label="缩小"
            onClick={() => zoomOut()}
            className="tc-ui-glow-btn flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--tc-menu-item-hover)]"
            style={{ color: "var(--tc-text-secondary)" }}
          >
            <Minus width={12} height={12} />
          </button>
          <button
            type="button"
            aria-label="缩放 100%"
            aria-expanded="false"
            onClick={handleReset}
            className="tc-ui-glow-btn inline-flex h-7 w-16 items-center justify-end gap-1.5 rounded-lg px-1.5 text-xs font-medium transition-colors hover:bg-[var(--tc-menu-item-hover)]"
            style={{ color: "var(--tc-text-primary)" }}
          >
            <span className="relative z-[1] flex-1 text-right">
              {Math.round(zoom * 100)}%
            </span>
            <ChevronDown
              width={11}
              height={11}
              stroke="var(--tc-text-tertiary)"
            />
          </button>
          <button
            type="button"
            aria-label="放大"
            onClick={() => zoomIn()}
            className="tc-ui-glow-btn flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--tc-menu-item-hover)]"
            style={{ color: "var(--tc-text-secondary)" }}
          >
            <Plus width={12} height={12} />
          </button>
        </div>
        <div
          className="mx-0.5 h-4 w-px"
          style={{ background: "var(--tc-border-subtle)" }}
        />
        <button
          type="button"
          aria-label="键盘快捷键"
          className="tc-ui-glow-btn flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--tc-menu-item-hover)]"
          style={{ color: "var(--tc-text-secondary)" }}
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
