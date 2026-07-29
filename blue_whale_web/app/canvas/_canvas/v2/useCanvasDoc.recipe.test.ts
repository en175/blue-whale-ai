// @vitest-environment jsdom
/**
 * useCanvasDoc Layer 2 不变量：视频 recipe「创建即写」+ succeeded 只 patch assetId 时 recipe 保留。
 *
 * 支撑 page 视频生成新流程（recipe 不再拖到 succeeded 写）：
 *   1. addNodeFull 建 running 占位即带 recipe → running/失败窗口期也有溯源。
 *   2. patchNode 浅 merge → setNodeAsset 只传 {assetId,status} 不覆盖已有 recipe。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvasDoc } from "./useCanvasDoc";
import type { CanvasNode, NodeRecipe } from "../model";
import { saveCanvas } from "../../../../lib/canvas";

vi.mock("../../../../lib/canvas", () => ({
  loadCanvas: vi.fn().mockResolvedValue({ nodes: "[]", viewport: null }),
  saveCanvas: vi.fn().mockResolvedValue(undefined),
}));

const recipe: NodeRecipe = {
  origin: "generated",
  generation: {
    model: "doubao-seedance",
    inputs: { prompt: { kind: "text", text: "橘猫凑进来" }, firstFrame: { kind: "image", url: "ff.png" } },
    params: { refMode: "first-last", duration: 5, resolution: "720p", aspectRatio: "16:9" },
    mediaKind: "video",
    generatedAt: "2026-07-23T08:10:51.057Z",
  },
};

const runningVideoNode: CanvasNode = {
  id: "n_vid",
  type: "video",
  position: { x: 0, y: 0 },
  width: 356,
  height: 200,
  data: { content: "橘猫凑进来", kind: "video", status: "running", progress: 0, recipe },
} as unknown as CanvasNode;

beforeEach(() => vi.clearAllMocks());

describe("useCanvasDoc 视频 recipe 生命周期", () => {
  it("running 占位创建即带 recipe（不等 succeeded）", () => {
    const { result } = renderHook(() => useCanvasDoc());
    act(() => result.current.addNodeFull(runningVideoNode));
    const n = result.current.nodes.find((x) => x.id === "n_vid");
    expect(n?.data.status).toBe("running");
    expect(n?.data.recipe).toEqual(recipe); // ★ 窗口期即有溯源
    expect(n?.data.assetId).toBeUndefined(); // assetId 尚未产出
  });

  it("★succeeded 只 patch {assetId,status} → recipe 保留不被覆盖", () => {
    const { result } = renderHook(() => useCanvasDoc());
    act(() => result.current.addNodeFull(runningVideoNode));
    // 模拟 setNodeAsset 的 patch（不传 recipe，对应新流程）
    act(() => result.current.patchNode("n_vid", { assetId: "167", status: "done" }));
    const n = result.current.nodes.find((x) => x.id === "n_vid");
    expect(n?.data.status).toBe("done");
    expect(n?.data.assetId).toBe("167");
    expect(n?.data.recipe).toEqual(recipe); // ★ 浅 merge 保留原 recipe
  });

  it("failed 窗口期节点仍带 recipe（溯源不丢）", () => {
    const { result } = renderHook(() => useCanvasDoc());
    act(() => result.current.addNodeFull(runningVideoNode));
    act(() => result.current.patchNode("n_vid", { status: "error", errorMessage: "生成失败" }));
    const n = result.current.nodes.find((x) => x.id === "n_vid");
    expect(n?.data.status).toBe("error");
    expect(n?.data.recipe).toEqual(recipe); // 失败也保留配方，可重试/溯源
  });

  it("save 持久化 running 图片节点的 recipe + taskId", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useCanvasDoc());
      await act(async () => {
        await result.current.load("1");
      });
      act(() => {
        result.current.addNodeFull({
          ...runningVideoNode,
          id: "n_img",
          type: "image",
          data: { ...runningVideoNode.data, kind: "image", taskId: "777" },
        } as CanvasNode);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
      });

      const serializedNodes = (saveCanvas as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[2] as string;
      expect(JSON.parse(serializedNodes)[0]).toMatchObject({
        id: "n_img",
        taskId: "777",
        recipe,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("job 接纳后立即持久化 recipe + taskId，不等待 800ms debounce", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useCanvasDoc());
      await act(async () => {
        await result.current.load("1");
      });
      act(() => {
        result.current.addNodeFull({
          ...runningVideoNode,
          id: "n_img",
          type: "image",
          data: { ...runningVideoNode.data, kind: "image" },
        } as CanvasNode);
      });

      await act(async () => {
        await result.current.patchNodeAndSave("n_img", { taskId: "777" });
      });

      expect(saveCanvas).toHaveBeenCalledTimes(1);
      const serializedNodes = (saveCanvas as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
      expect(JSON.parse(serializedNodes)[0]).toMatchObject({
        id: "n_img",
        taskId: "777",
        recipe,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
