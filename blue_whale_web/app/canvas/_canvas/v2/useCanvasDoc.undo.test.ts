// @vitest-environment jsdom
/**
 * useCanvasDoc 撤销/重做栈回归（IK7ZME）。
 *
 * latest-ref → 直接捕获重构后为「行为等价」补自动化安全网：
 *   1. 删除入栈 → undo 恢复 → redo 再删除（canUndo/canRedo 状态同步）
 *   2. 栈上限 20 步截断
 *   3. load 切项目清空双栈
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvasDoc } from "./useCanvasDoc";
import { loadCanvas, saveCanvas } from "../../../../lib/canvas";
import type { CanvasDto } from "../../../../lib/canvas";

const emptyCanvasDto: CanvasDto = {
  id: null,
  project_id: 1,
  nodes: "[]",
  viewport: "null",
};

vi.mock("../../../../lib/canvas", () => ({
  loadCanvas: vi.fn(),
  saveCanvas: vi.fn(),
}));

const nodeA = {
  id: "n1",
  type: "image",
  position: { x: 0, y: 0 },
  width: 200,
  height: 120,
  data: { kind: "image", assetId: "a1", status: "succeeded" },
};

const nodeB = {
  id: "n2",
  type: "text",
  position: { x: 300, y: 0 },
  data: { kind: "text", content: "说明文字" },
};

function canvasWithNodes(nodes: unknown[]): CanvasDto {
  return {
    ...emptyCanvasDto,
    id: "9",
    version: 3,
    nodes: JSON.stringify({ version: 1, nodes, edges: [] }),
  };
}

async function renderLoaded(nodes: unknown[], projectId = "1") {
  vi.mocked(loadCanvas).mockResolvedValueOnce(canvasWithNodes(nodes));
  const { result } = renderHook(() => useCanvasDoc());
  await act(async () => {
    await result.current.load(projectId);
  });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveCanvas).mockResolvedValue({ ...emptyCanvasDto, id: "9", version: 4 });
});

describe("useCanvasDoc 撤销/重做（IK7ZME 行为等价回归）", () => {
  it("删除节点入栈，undo 恢复，redo 再删除", async () => {
    const result = await renderLoaded([nodeA, nodeB]);
    expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);

    await act(async () => {
      await result.current.removeNodeAndSave("n1");
    });
    expect(result.current.nodes.map((n) => n.id)).toEqual(["n2"]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    act(() => {
      result.current.undo();
    });
    expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.redo();
    });
    expect(result.current.nodes.map((n) => n.id)).toEqual(["n2"]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("撤销栈最多保留 20 步，超出截断", async () => {
    const result = await renderLoaded([nodeA, nodeB]);

    act(() => {
      for (let i = 0; i < 25; i += 1) {
        result.current.pushUndo();
      }
    });
    expect(result.current.canUndo).toBe(true);

    // 连续 undo 20 次应耗尽栈；若未截断（25 步入栈）此时 canUndo 仍会为 true。
    act(() => {
      for (let i = 0; i < 20; i += 1) {
        result.current.undo();
      }
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it("load 切换项目时清空撤销/重做栈", async () => {
    const result = await renderLoaded([nodeA, nodeB]);

    act(() => {
      result.current.pushUndo();
    });
    expect(result.current.canUndo).toBe(true);

    vi.mocked(loadCanvas).mockResolvedValueOnce(canvasWithNodes([nodeB]));
    await act(async () => {
      await result.current.load("2");
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("空栈 undo/redo 安全 no-op", async () => {
    const result = await renderLoaded([nodeA]);

    act(() => {
      result.current.undo();
      result.current.redo();
    });
    expect(result.current.nodes.map((n) => n.id)).toEqual(["n1"]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});
