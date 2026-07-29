// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider, type Node } from "@xyflow/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SelectionBounds } from "./SelectionBounds";
import { SELECTION_PAD } from "./toolMode";

/**
 * IK55VD 自绘选中包围虚线框：RF 内置 nodesselection-rect 被 CSS 隐藏，
 * 改由 SelectionBounds 按选中节点并集外扩 SELECTION_PAD(2px) 绘制。
 * jsdom 渲染 ReactFlow 需 stub ResizeObserver / DOMMatrixReadOnly（xyflow 官方测试做法）。
 */
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      m22: number;
      constructor(transform?: string) {
        const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
        this.m22 = scale !== undefined ? Number(scale) : 1;
      }
    },
  );
});

function renderCanvas(nodes: Node[]) {
  return render(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow nodes={nodes} edges={[]} onNodesChange={() => {}}>
          <SelectionBounds />
        </ReactFlow>
      </div>
    </ReactFlowProvider>,
  );
}

describe("SelectionBounds", () => {
  it("按选中节点并集外扩 2px 渲染 1px dotted 包围框", async () => {
    renderCanvas([
      {
        id: "a",
        position: { x: 10, y: 20 },
        width: 100,
        height: 50,
        selected: true,
        data: {},
      },
      {
        id: "b",
        position: { x: 300, y: 300 },
        width: 100,
        height: 100,
        selected: false,
        data: {},
      },
    ]);

    const box = await screen.findByTestId("selection-bounds");
    expect(box.style.width).toBe(`${100 + SELECTION_PAD * 2}px`);
    expect(box.style.height).toBe(`${50 + SELECTION_PAD * 2}px`);
    expect(box.style.transform).toBe(
      `translate(${10 - SELECTION_PAD}px, ${20 - SELECTION_PAD}px)`,
    );
    expect(box.style.border).toContain("dotted");
    // jsdom 不解析含 var() 的 border  shorthand，无法展开 borderWidth，改断言原始字符串
    expect(box.style.border).toContain("1px");
    expect(box.style.border).toContain("var(--tc-text-tertiary)");
  });

  it("多个选中节点取并集 bounds", async () => {
    renderCanvas([
      {
        id: "a",
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        selected: true,
        data: {},
      },
      {
        id: "b",
        position: { x: 200, y: 150 },
        width: 100,
        height: 100,
        selected: true,
        data: {},
      },
    ]);

    const box = await screen.findByTestId("selection-bounds");
    // 并集: x=0..300, y=0..250，再各向外扩 2px
    expect(box.style.width).toBe(`${300 + SELECTION_PAD * 2}px`);
    expect(box.style.height).toBe(`${250 + SELECTION_PAD * 2}px`);
    expect(box.style.transform).toBe(
      `translate(${0 - SELECTION_PAD}px, ${0 - SELECTION_PAD}px)`,
    );
  });

  it("无选中节点时不渲染", () => {
    renderCanvas([
      { id: "a", position: { x: 0, y: 0 }, width: 100, height: 50, data: {} },
    ]);
    expect(screen.queryByTestId("selection-bounds")).toBeNull();
  });
});
