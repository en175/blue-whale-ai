import { describe, expect, it } from "vitest";
import {
  SELECTION_PAD,
  effectiveToolMode,
  toolModeInteractionProps,
} from "./toolMode";

/**
 * IK55VD 工具模式：toolModeInteractionProps 是纯函数，输出 ReactFlow 交互 props。
 * - 鼠标模式：左键框选、中/右键平移，节点可拖可选（现状行为）。
 * - 抓手模式：左键平移，不框选 / 不点选 / 不拖节点。
 */
describe("toolModeInteractionProps", () => {
  it("鼠标模式：selectionOnDrag + panOnDrag=[1,2]，节点可选可拖", () => {
    expect(toolModeInteractionProps("mouse")).toEqual({
      panOnDrag: [1, 2],
      selectionOnDrag: true,
      elementsSelectable: true,
      nodesDraggable: true,
    });
  });

  it("抓手模式：panOnDrag=true，不框选 / 不点选 / 不拖节点", () => {
    expect(toolModeInteractionProps("hand")).toEqual({
      panOnDrag: true,
      selectionOnDrag: false,
      elementsSelectable: false,
      nodesDraggable: false,
    });
  });
});

describe("effectiveToolMode", () => {
  it("按住空格临时切入抓手，松开恢复持久模式", () => {
    expect(effectiveToolMode("mouse", false)).toBe("mouse");
    expect(effectiveToolMode("mouse", true)).toBe("hand");
    expect(effectiveToolMode("hand", false)).toBe("hand");
    expect(effectiveToolMode("hand", true)).toBe("hand");
  });
});

describe("SELECTION_PAD", () => {
  it("自绘选中虚线框相对节点并集外扩 2px", () => {
    expect(SELECTION_PAD).toBe(2);
  });
});
