// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasSurface } from "./CanvasSurface";

/**
 * IK55VD CanvasSurface 模式接线：wrapper mode class 驱动光标 CSS
 * （tool-mode-mouse=默认箭头 / tool-mode-hand=grab、拖动中 grabbing）。
 * 交互 props 本身由 toolMode.test.ts 覆盖纯函数，这里只验证 mode → class 接线。
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

const baseProps = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  onNodesChange: () => {},
  onEdgesChange: () => {},
  onConnect: () => {},
  onViewportChange: () => {},
};

function renderSurface(
  props: Partial<Parameters<typeof CanvasSurface>[0]> = {},
) {
  return render(
    <ReactFlowProvider>
      <CanvasSurface {...baseProps} {...props} />
    </ReactFlowProvider>,
  );
}

describe("CanvasSurface 工具模式", () => {
  it("默认（鼠标模式）wrapper 带 tool-mode-mouse", () => {
    const { container } = renderSurface();
    const wrapper = container.querySelector(".tc-canvas-surface");
    expect(wrapper?.classList.contains("tool-mode-mouse")).toBe(true);
    expect(wrapper?.classList.contains("tool-mode-hand")).toBe(false);
  });

  it("toolMode=hand 时 wrapper 带 tool-mode-hand", () => {
    const { container } = renderSurface({ toolMode: "hand" });
    const wrapper = container.querySelector(".tc-canvas-surface");
    expect(wrapper?.classList.contains("tool-mode-hand")).toBe(true);
    expect(wrapper?.classList.contains("tool-mode-mouse")).toBe(false);
  });
});
