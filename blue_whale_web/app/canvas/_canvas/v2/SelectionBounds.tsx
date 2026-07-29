/**
 * IK55VD 自绘选中包围虚线框：RF 内置 .react-flow__nodesselection-rect 由 CSS 隐藏
 * （与卡片描边 0 间隙、选中描边外凸），改为按选中节点并集外扩 SELECTION_PAD 绘制 1px dotted 包围框。
 * useShallow 必须引自 zustand/react/shallow（@xyflow/react 不导出）。
 */
import { useMemo } from "react";
import { ViewportPortal, getNodesBounds, useStore } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";
import { SELECTION_PAD } from "./toolMode";

export function SelectionBounds() {
  const selected = useStore(
    useShallow((s) => s.nodes.filter((n) => n.selected)),
  );
  const bounds = useMemo(
    () => (selected.length ? getNodesBounds(selected) : null),
    [selected],
  );
  if (!bounds) return null;
  return (
    <ViewportPortal>
      <div
        data-testid="selection-bounds"
        style={{
          position: "absolute",
          transform: `translate(${bounds.x - SELECTION_PAD}px, ${bounds.y - SELECTION_PAD}px)`,
          width: bounds.width + SELECTION_PAD * 2,
          height: bounds.height + SELECTION_PAD * 2,
          border: "1px dotted var(--tc-text-tertiary)",
          pointerEvents: "none",
        }}
      />
    </ViewportPortal>
  );
}
