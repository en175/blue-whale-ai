/**
 * IK55VD 画布工具模式（鼠标 / 抓手 + 空格临时切换）—— 纯函数层。
 * toolModeInteractionProps 输出按模式变化的 ReactFlow 交互 props（其余 props 由 CanvasSurface 保留现状）；
 * effectiveToolMode 合成有效模式（持久模式 OR 按住空格）；SELECTION_PAD 是自绘选中虚线框的外扩像素。
 */
export type ToolMode = "mouse" | "hand";

export type ToolModeInteractionProps = {
  panOnDrag: boolean | number[];
  selectionOnDrag: boolean;
  elementsSelectable: boolean;
  nodesDraggable: boolean;
};

/** 鼠标模式：左键框选、中/右键平移，节点可选可拖；抓手模式：左键平移，不框选/点选/拖节点。 */
export function toolModeInteractionProps(
  mode: ToolMode,
): ToolModeInteractionProps {
  return mode === "hand"
    ? {
        panOnDrag: true,
        selectionOnDrag: false,
        elementsSelectable: false,
        nodesDraggable: false,
      }
    : {
        panOnDrag: [1, 2],
        selectionOnDrag: true,
        elementsSelectable: true,
        nodesDraggable: true,
      };
}

/** 有效模式：按住空格临时切入抓手，松开恢复持久模式。 */
export function effectiveToolMode(
  mode: ToolMode,
  spaceHeld: boolean,
): ToolMode {
  return mode === "hand" || spaceHeld ? "hand" : "mouse";
}

/** 自绘选中虚线框相对选中节点并集的外扩像素。 */
export const SELECTION_PAD = 2;
