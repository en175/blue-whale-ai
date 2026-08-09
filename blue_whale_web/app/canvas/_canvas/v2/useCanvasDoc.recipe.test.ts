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
import { loadCanvas, saveCanvas } from "../../../../lib/canvas";
import type { CanvasDto } from "../../../../lib/canvas";

const emptyCanvasDto: CanvasDto = {
  id: null,
  project_id: 1,
  nodes: "[]",
  viewport: "null",
};

vi.mock("../../../../lib/canvas", () => ({
  loadCanvas: vi.fn().mockResolvedValue({
    id: null,
    project_id: 1,
    nodes: "[]",
    viewport: "null",
  }),
  saveCanvas: vi.fn().mockResolvedValue(undefined),
}));

const recipe: NodeRecipe = {
  origin: "generated",
  generation: {
    model: "doubao-seedance",
    inputs: {
      prompt: { kind: "text", text: "橘猫凑进来" },
      firstFrame: { kind: "image", url: "ff.png" },
    },
    params: {
      refMode: "first-last",
      duration: 5,
      resolution: "720p",
      aspectRatio: "16:9",
    },
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
  data: {
    content: "橘猫凑进来",
    kind: "video",
    status: "running",
    progress: 0,
    recipe,
  },
} as unknown as CanvasNode;

beforeEach(() => vi.clearAllMocks());

describe("useCanvasDoc 视频 recipe 生命周期", () => {
  it("删除场景卡时立即条件保存节点和关联边", async () => {
    vi.mocked(loadCanvas).mockResolvedValueOnce({
      ...emptyCanvasDto,
      id: "9",
      version: 3,
      nodes: JSON.stringify({
        version: 1,
        nodes: [
          {
            id: "scene-card:7",
            type: "scene-card",
            position: { x: 0, y: 0 },
            data: { sceneCardId: "7" },
          },
          {
            id: "text-1",
            type: "text",
            position: { x: 500, y: 0 },
            data: { kind: "text", content: "说明" },
          },
        ],
        edges: [
          {
            id: "edge-1",
            source: "scene-card:7",
            target: "text-1",
          },
        ],
      }),
    });
    vi.mocked(saveCanvas).mockResolvedValueOnce({
      ...emptyCanvasDto,
      id: "9",
      version: 4,
    });
    const { result } = renderHook(() => useCanvasDoc());
    await act(async () => {
      await result.current.load("1");
    });
    const removeNodeAndSave = (
      result.current as unknown as {
        removeNodeAndSave?: (id: string) => Promise<boolean>;
      }
    ).removeNodeAndSave;

    expect(removeNodeAndSave).toBeTypeOf("function");
    await act(async () => {
      await removeNodeAndSave?.("scene-card:7");
    });

    expect(result.current.nodes.map((node) => node.id)).toEqual(["text-1"]);
    expect(result.current.edges).toEqual([]);
    expect(saveCanvas).toHaveBeenCalledWith(
      1,
      expect.any(String),
      expect.not.stringContaining("scene-card:7"),
      3,
    );
  });

  it("场景卡已删除但 Canvas 保存冲突时保留不可用节点", async () => {
    vi.mocked(loadCanvas).mockResolvedValueOnce({
      ...emptyCanvasDto,
      id: "9",
      version: 3,
      nodes: JSON.stringify([
        {
          id: "scene-card:7",
          type: "scene-card",
          position: { x: 0, y: 0 },
          data: { sceneCardId: "7" },
        },
      ]),
    });
    vi.mocked(saveCanvas).mockRejectedValueOnce(new Error("HTTP 412"));
    const { result } = renderHook(() => useCanvasDoc());
    await act(async () => {
      await result.current.load("1");
    });

    let removed = true;
    await act(async () => {
      removed = await result.current.removeNodeAndSave("scene-card:7");
    });

    expect(removed).toBe(false);
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0]?.data.unavailableReason).toBe("deleted");
  });

  it("恢复重复场景卡引用时保留一条有效节点并标记其余节点不可用", async () => {
    vi.mocked(loadCanvas).mockResolvedValueOnce({
      ...emptyCanvasDto,
      nodes: JSON.stringify([
        {
          id: "scene-card:7",
          type: "scene-card",
          position: { x: 0, y: 0 },
          data: { sceneCardId: "7" },
        },
        {
          id: "scene_card_7",
          type: "scene_card",
          scene_card_id: "7",
          position: { x: 500, y: 0 },
        },
      ]),
    });
    const { result } = renderHook(() => useCanvasDoc());

    await act(async () => {
      await result.current.load("1");
    });

    expect(result.current.nodes).toHaveLength(2);
    expect(new Set(result.current.nodes.map((node) => node.id)).size).toBe(2);
    expect(result.current.nodes[0]?.data.unavailableReason).toBeUndefined();
    expect(result.current.nodes[1]?.data.unavailableReason).toBe("duplicate");
  });

  it("恢复历史脏数据时仍去除普通节点的重复 id", async () => {
    vi.mocked(loadCanvas).mockResolvedValueOnce({
      ...emptyCanvasDto,
      nodes: JSON.stringify([
        {
          id: "text-1",
          type: "text",
          position: { x: 0, y: 0 },
          data: { kind: "text", content: "第一条" },
        },
        {
          id: "text-1",
          type: "text",
          position: { x: 100, y: 0 },
          data: { kind: "text", content: "重复条" },
        },
      ]),
    });
    const { result } = renderHook(() => useCanvasDoc());

    await act(async () => {
      await result.current.load("1");
    });

    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0]?.data.content).toBe("第一条");
  });

  it("连续保存使用服务端返回的最新 Canvas 版本", async () => {
    vi.useFakeTimers();
    vi.mocked(loadCanvas).mockResolvedValueOnce({
      ...emptyCanvasDto,
      id: "9",
      version: 3,
    });
    vi.mocked(saveCanvas)
      .mockResolvedValueOnce({
        ...emptyCanvasDto,
        id: "9",
        version: 4,
      })
      .mockResolvedValueOnce({
        ...emptyCanvasDto,
        id: "9",
        version: 5,
      });
    try {
      const { result } = renderHook(() => useCanvasDoc());
      await act(async () => {
        await result.current.load("1");
      });

      act(() => result.current.addNodeFull(runningVideoNode));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
      });
      expect(saveCanvas).toHaveBeenLastCalledWith(
        1,
        expect.any(String),
        expect.any(String),
        3,
      );

      act(() => result.current.patchNode("n_vid", { status: "done" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
      });
      expect(saveCanvas).toHaveBeenLastCalledWith(
        1,
        expect.any(String),
        expect.any(String),
        4,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("场景卡实测尺寸变化会持久化实际高度", async () => {
    vi.useFakeTimers();
    vi.mocked(loadCanvas).mockResolvedValueOnce({
      ...emptyCanvasDto,
      nodes: JSON.stringify([
        {
          id: "scene-card:7",
          type: "scene-card",
          position: { x: 0, y: 0 },
          width: 400,
          height: 1080,
          data: { sceneCardId: "7" },
        },
      ]),
    });
    try {
      const { result } = renderHook(() => useCanvasDoc());
      await act(async () => {
        await result.current.load("1");
      });
      vi.mocked(saveCanvas).mockClear();

      act(() =>
        result.current.onNodesChange([
          {
            id: "scene-card:7",
            type: "dimensions",
            dimensions: { width: 400, height: 420 },
          },
        ]),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
      });

      expect(saveCanvas).toHaveBeenCalledTimes(1);
      const serialized = vi.mocked(saveCanvas).mock.calls[0]?.[2] ?? "[]";
      expect(JSON.parse(serialized)[0]).toMatchObject({
        id: "scene-card:7",
        width: 400,
        height: 420,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("超大项目 ID 加载和保存时保持十进制字符串精度", async () => {
    vi.useFakeTimers();
    const projectId = "9007199254740993";
    try {
      const { result } = renderHook(() => useCanvasDoc());
      await act(async () => {
        await result.current.load(projectId);
      });
      expect(loadCanvas).toHaveBeenCalledWith(projectId);

      act(() => result.current.addNodeFull(runningVideoNode));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
      });

      expect(saveCanvas).toHaveBeenCalledWith(
        projectId,
        expect.any(String),
        expect.any(String),
        null,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("切换项目会取消上一项目尚未触发的保存", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useCanvasDoc());
      await act(async () => {
        await result.current.load("1");
      });
      act(() => result.current.addNodeFull(runningVideoNode));

      await act(async () => {
        await result.current.load("2");
        await vi.advanceTimersByTimeAsync(800);
      });

      expect(saveCanvas).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("加载返回时保留加载期间新建的上传占位", async () => {
    vi.useFakeTimers();
    let resolveLoad!: (value: CanvasDto | PromiseLike<CanvasDto>) => void;
    vi.mocked(loadCanvas).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    try {
      const { result } = renderHook(() => useCanvasDoc());

      let loading!: Promise<unknown>;
      act(() => {
        loading = result.current.load("1");
      });
      act(() => result.current.addNodeFull(runningVideoNode));
      await act(async () => {
        await result.current.patchNodeAndSave("n_vid", { taskId: "777" });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
      });
      expect(saveCanvas).not.toHaveBeenCalled();

      resolveLoad({
        ...emptyCanvasDto,
        nodes: JSON.stringify([
          {
            id: "server_node",
            type: "text",
            position: { x: 0, y: 0 },
            data: { kind: "text", content: "已保存" },
          },
        ]),
      });
      await act(async () => {
        await loading;
        await vi.advanceTimersByTimeAsync(800);
      });

      expect(result.current.nodes.map((node) => node.id)).toEqual([
        "server_node",
        "n_vid",
      ]);
      const serializedNodes = (
        saveCanvas as ReturnType<typeof vi.fn>
      ).mock.calls.at(-1)?.[2] as string;
      expect(
        JSON.parse(serializedNodes).map((node: { id: string }) => node.id),
      ).toEqual(["server_node", "n_vid"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("加载失败进入错误态，重试成功后恢复", async () => {
    vi.mocked(loadCanvas)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(emptyCanvasDto);
    const { result } = renderHook(() => useCanvasDoc());

    await act(async () => {
      await expect(result.current.load("1")).rejects.toThrow("network down");
    });
    expect(result.current.loadState).toBe("error");

    await act(async () => {
      await result.current.load("1");
    });
    expect(result.current.loadState).toBe("ready");
  });

  it("原位更新上传占位节点尺寸", () => {
    const { result } = renderHook(() => useCanvasDoc());
    act(() => result.current.addNodeFull(runningVideoNode));

    act(() => result.current.resizeNode("n_vid", 480, 270));

    expect(
      result.current.nodes.find((node) => node.id === "n_vid"),
    ).toMatchObject({
      width: 480,
      height: 270,
    });
  });

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
    act(() =>
      result.current.patchNode("n_vid", { assetId: "167", status: "done" }),
    );
    const n = result.current.nodes.find((x) => x.id === "n_vid");
    expect(n?.data.status).toBe("done");
    expect(n?.data.assetId).toBe("167");
    expect(n?.data.recipe).toEqual(recipe); // ★ 浅 merge 保留原 recipe
  });

  it("failed 窗口期节点仍带 recipe（溯源不丢）", () => {
    const { result } = renderHook(() => useCanvasDoc());
    act(() => result.current.addNodeFull(runningVideoNode));
    act(() =>
      result.current.patchNode("n_vid", {
        status: "error",
        errorMessage: "生成失败",
      }),
    );
    const n = result.current.nodes.find((x) => x.id === "n_vid");
    expect(n?.data.status).toBe("error");
    expect(n?.data.recipe).toEqual(recipe); // 失败也保留配方，可重试/溯源
  });

  it("patchNode persist:false 只更新内存，不保存 Canvas", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useCanvasDoc());
      await act(async () => {
        await result.current.load("1");
      });
      act(() => result.current.addNodeFull(runningVideoNode));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
      });
      vi.mocked(saveCanvas).mockClear();

      act(() =>
        result.current.patchNode("n_vid", { progress: 45 }, { persist: false }),
      );
      expect(result.current.nodes[0]?.data.progress).toBe(45);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
      });

      expect(saveCanvas).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("patchNode 默认仍持久化 Canvas", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useCanvasDoc());
      await act(async () => {
        await result.current.load("1");
      });
      act(() => result.current.addNodeFull(runningVideoNode));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
      });
      vi.mocked(saveCanvas).mockClear();

      act(() => result.current.patchNode("n_vid", { status: "done" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
      });

      expect(saveCanvas).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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

      const serializedNodes = (
        saveCanvas as ReturnType<typeof vi.fn>
      ).mock.calls.at(-1)?.[2] as string;
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
      const serializedNodes = (saveCanvas as ReturnType<typeof vi.fn>).mock
        .calls[0][2] as string;
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
